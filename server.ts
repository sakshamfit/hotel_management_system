import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, UserRecord, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import firebaseConfigJson from './firebase-applet-config.json';

// Initialize Firebase Admin SDK
if (!getApps().length) {
  try {
    initializeApp({
      projectId: firebaseConfigJson.projectId || 'direct-citizen-1s6r9',
    });
    console.log('Firebase Admin SDK initialized successfully for project:', firebaseConfigJson.projectId);
  } catch (err) {
    console.error('Error initializing Firebase Admin SDK:', err);
  }
}

const adminAuth = getAuth();
const adminFirestore = getFirestore();

// ---------------------------------------------------------------------------
// Rate limiting (per-instance, in-memory)
// ---------------------------------------------------------------------------
// Enough to make online guessing of room tokens / credential stuffing
// impractical. For a multi-instance deployment back this with Redis/Firestore.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The CHECKED_IN booking currently occupying a room, if any.
 *
 * Uses a single equality filter (roomId) and filters status in code — a
 * composite (roomId + status) index would otherwise be required, and rooms
 * have few enough bookings for this to be cheap.
 */
async function findActiveBooking(hotelId: string, roomId: string) {
  const snap = await adminFirestore
    .collection('hotels')
    .doc(hotelId)
    .collection('bookings')
    .where('roomId', '==', roomId)
    .limit(50)
    .get();

  const match = snap.docs.find((d) => d.data()?.status === 'CHECKED_IN');
  if (!match) return null;
  return { id: match.id, ...match.data() } as { id: string; guestId?: string; [key: string]: unknown };
}

/** Display name for the in-house guest, resolved from guests/{guestId}. */
async function resolveGuestName(hotelId: string, guestId?: string): Promise<string> {
  if (!guestId) return '';
  try {
    const snap = await adminFirestore
      .collection('hotels')
      .doc(hotelId)
      .collection('guests')
      .doc(guestId)
      .get();
    return snap.exists ? String((snap.data() as { name?: string })?.name || '') : '';
  } catch (err) {
    console.warn('Could not resolve guest name:', err);
    return '';
  }
}

// Middleware to verify Firebase ID token and super_admin claim
async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (decodedToken.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required' });
    }
    (req as any).user = decodedToken;
    next();
  } catch (err: any) {
    console.error('Token verification error:', err);
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Small body cap: every API here takes a handful of string fields.
  app.use(express.json({ limit: '64kb' }));

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      projectId: firebaseConfigJson.projectId,
      firestoreDatabaseId: firebaseConfigJson.firestoreDatabaseId,
    });
  });

  // -----------------------------------------------------------------------
  // Guest session — exchange a room QR token for room-scoped custom claims.
  //
  // The ONLY way an unauthenticated visitor obtains any access. It:
  //   • requires a valid Firebase ID token (the caller is signed in),
  //   • refuses any caller that is not an anonymous user,
  //   • refuses to downgrade or overwrite an existing staff role,
  //   • resolves the token server-side, so the client can never enumerate
  //     across tenants,
  //   • grants only { role: 'guest', hotelId, roomId, roomNumber }.
  //
  // Super admins are NOT minted here — see scripts/create-super-admin.ts.
  // -----------------------------------------------------------------------
  app.post('/api/guest/session', rateLimit(20, 60_000), async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const roomToken = typeof req.body?.roomToken === 'string' ? req.body.roomToken.trim() : '';
    if (!roomToken || roomToken.length > 256) {
      return res.status(400).json({ error: 'A room token is required.', code: 'guest/invalid-token' });
    }

    try {
      const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);

      // Anonymous users only — never touch a real account's claims.
      const isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
      if (!isAnonymous) {
        return res.status(403).json({
          error: 'Only anonymous guest sessions can be scoped to a room.',
          code: 'guest/not-anonymous',
        });
      }
      if (decoded.role) {
        // A signed-in staff member must never be demoted to guest scope.
        return res.status(403).json({
          error: 'This session already holds a staff role.',
          code: 'guest/already-roled',
        });
      }

      // Resolve the token across every hotel (Admin SDK bypasses rules; the
      // client could not perform this collection-group query itself).
      const snap = await adminFirestore
        .collectionGroup('rooms')
        .where('permanentToken', '==', roomToken)
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(404).json({
          error: 'This room code is not recognised.',
          code: 'guest/unknown-room',
        });
      }

      const roomDoc = snap.docs[0];
      const hotelRef = roomDoc.ref.parent.parent;
      if (!hotelRef) {
        return res.status(404).json({ error: 'Malformed room reference.', code: 'guest/unknown-room' });
      }
      const roomData = roomDoc.data();
      const hotelId = hotelRef.id;
      const roomId = roomDoc.id;
      const roomNumber = typeof roomData.roomNumber === 'string' ? roomData.roomNumber : '';

      // The guest portal greets the in-house guest by name, but guests have no
      // read access to bookings or guests (they carry other people's PII). So
      // the server resolves the name once and hands it over as a display-only
      // claim instead of granting a collection read.
      const booking = await findActiveBooking(hotelId, roomId);
      const guestName = booking?.guestId ? await resolveGuestName(hotelId, booking.guestId) : '';

      await adminAuth.setCustomUserClaims(decoded.uid, {
        role: 'guest',
        hotelId,
        roomId,
        roomNumber,
        guestName: guestName || '',
      });

      return res.json({ success: true, hotelId, roomId, roomNumber, guestName: guestName || '' });
    } catch (err: any) {
      console.error('Guest session error:', err);
      return res.status(401).json({ error: 'Invalid or expired token', code: 'guest/invalid-session' });
    }
  });

  // -----------------------------------------------------------------------
  // Folio charge for a guest order.
  //
  // Req 4: an order placed in a room with an active CHECKED_IN booking raises
  // a FOOD/SERVICE charge on that booking's folio. Guests have no Firestore
  // access to folios at all (see firestore.rules), so this runs through the
  // Admin SDK. The order pipeline itself is untouched — the client calls this
  // after its normal order write succeeds.
  // -----------------------------------------------------------------------
  app.post(
    '/api/guest/orders/:orderId/charge',
    rateLimit(60, 60_000),
    async (req: Request, res: Response) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
      }

      const orderId = String(req.params.orderId || '').trim();
      if (!orderId || orderId.length > 128) {
        return res.status(400).json({ error: 'A valid order id is required.' });
      }

      let decoded: DecodedIdToken;
      try {
        decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
      } catch (err: any) {
        // A bad/expired token is an auth failure, not a server error.
        return res.status(401).json({ error: 'Invalid or expired token', code: 'guest/invalid-session' });
      }

      try {
        // Guest scope only, and only for the room this session was granted.
        if (
          decoded.firebase?.sign_in_provider !== 'anonymous' ||
          decoded.role !== 'guest' ||
          !decoded.hotelId ||
          !decoded.roomId
        ) {
          return res.status(403).json({ error: 'Not a room-scoped guest session.', code: 'guest/not-scoped' });
        }

        const hotelId = String(decoded.hotelId);
        const roomId = String(decoded.roomId);

        const orderSnap = await adminFirestore
          .collection('hotels')
          .doc(hotelId)
          .collection('orders')
          .doc(orderId)
          .get();

        if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found.' });

        const order = orderSnap.data() as {
          guestUid?: string;
          roomId?: string;
          type?: string;
          totalAmount?: number;
          items?: Array<{ name?: string; quantity?: number }>;
        };

        // A guest may only raise charges from their own orders, for their own room.
        if (order.guestUid !== decoded.uid || (order.roomId && order.roomId !== roomId)) {
          return res.status(403).json({ error: 'Order does not belong to this session.', code: 'guest/forbidden' });
        }

        const amount = Number(order.totalAmount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          return res.json({ linked: false, reason: 'zero-amount' });
        }

        const booking = await findActiveBooking(hotelId, roomId);
        if (!booking) {
          return res.json({ linked: false, reason: 'no-active-booking' });
        }

        const folioRef = adminFirestore.collection('hotels').doc(hotelId).collection('folios').doc(booking.id);
        const chargesRef = folioRef.collection('charges');

        // Idempotent: one charge per order, no matter how often this is called.
        const existing = await chargesRef.where('sourceOrderId', '==', orderId).limit(1).get();
        if (!existing.empty) {
          return res.json({ linked: true, reason: 'already-linked' });
        }

        const description =
          order.items && order.items.length > 0
            ? order.items
                .map((i) => `${i.quantity || 1}x ${i.name || 'Item'}`)
                .join(', ')
                .slice(0, 200)
            : order.type === 'service'
              ? 'Room service request'
              : 'In-room dining order';

        await adminFirestore.runTransaction(async (tx) => {
          const folioSnap = await tx.get(folioRef);
          tx.set(chargesRef.doc(), {
            type: order.type === 'service' ? 'SERVICE' : 'FOOD',
            description,
            amount,
            sourceOrderId: orderId,
            createdAt: FieldValue.serverTimestamp(),
          });
          if (folioSnap.exists) {
            tx.update(folioRef, { balance: FieldValue.increment(amount) });
          } else {
            // Booking created before folios existed — create it on demand.
            tx.set(folioRef, { bookingId: booking.id, status: 'OPEN', balance: amount });
          }
        });

        return res.json({ linked: true });
      } catch (err: any) {
        console.error('Order charge error:', err);
        return res.status(500).json({ error: err?.message || 'Could not post the charge.' });
      }
    }
  );

  // Create Hotel Admin User via Firebase Admin SDK
  // This endpoint creates the Firebase Auth user without logging out the currently signed-in Super Admin
  // and attaches the custom claim { role: "hotel_admin", hotelId: <hotelDocId> }
  app.post('/api/admin/create-hotel-user', requireSuperAdmin, async (req: Request, res: Response) => {
    const { hotelId, hotelName, email, password, name, phone } = req.body;

    if (!hotelId || !email || !password) {
      return res.status(400).json({ error: 'Missing required parameters: hotelId, email, and password' });
    }

    const trimmedEmail = email.toLowerCase().trim();
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
      let userRecord: UserRecord;
      let isNew = false;

      try {
        userRecord = await adminAuth.getUserByEmail(trimmedEmail);
        // Update password & name
        userRecord = await adminAuth.updateUser(userRecord.uid, {
          password,
          displayName: name || `${hotelName} Admin`,
        });
      } catch (notFound: any) {
        // Create new user in Firebase Auth
        userRecord = await adminAuth.createUser({
          email: trimmedEmail,
          password,
          displayName: name || `${hotelName} Admin`,
          phoneNumber: phone && phone.startsWith('+') ? phone : undefined,
          emailVerified: true,
        });
        isNew = true;
      }

      // Set Custom Claims: { role: 'hotel_admin', hotelId }
      await adminAuth.setCustomUserClaims(userRecord.uid, {
        role: 'hotel_admin',
        hotelId,
      });

      // Persist role in Firestore users/{uid} so client-side role lookup works
      // (free tier: role lives in Firestore, token may not carry custom claims yet).
      await adminFirestore.collection('users').doc(userRecord.uid).set(
        {
          role: 'hotel_admin',
          hotelId,
          email: trimmedEmail,
          displayName: name || `${hotelName} Admin`,
          phone: phone || '',
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return res.json({
        success: true,
        isNew,
        uid: userRecord.uid,
        email: userRecord.email,
        hotelId,
        role: 'hotel_admin',
        message: `Hotel Admin ${trimmedEmail} successfully created/updated with custom claim for hotelId: ${hotelId}`,
      });
    } catch (err: any) {
      console.error('Error creating hotel admin user:', err);
      return res.status(500).json({ error: err.message || 'Failed to create hotel admin user' });
    }
  });

  // Delete Hotel Admin User
  app.post('/api/admin/delete-hotel-user', requireSuperAdmin, async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const userRecord = await adminAuth.getUserByEmail(email.toLowerCase().trim());

      // Remove the Firestore role document too (best effort)
      try {
        await adminFirestore.collection('users').doc(userRecord.uid).delete();
      } catch (firestoreErr: any) {
        console.warn('Could not delete users/{uid} role doc:', firestoreErr.message);
      }

      await adminAuth.deleteUser(userRecord.uid);
      return res.json({ success: true, message: `User ${email} deleted from Firebase Auth` });
    } catch (err: any) {
      // If user not found, treat as already deleted
      return res.json({ success: true, message: 'User not found or already deleted' });
    }
  });

  // Set Custom Claims Endpoint (Super Admin only)
  app.post(
    '/api/admin/set-user-claims',
    requireSuperAdmin,
    rateLimit(30, 60_000),
    async (req: Request, res: Response) => {
    const { email, role, hotelId } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    try {
      const userRecord = await adminAuth.getUserByEmail(email.toLowerCase().trim());
      const claims: Record<string, any> = { role };
      if (role === 'hotel_admin' && hotelId) {
        claims.hotelId = hotelId;
      }

      await adminAuth.setCustomUserClaims(userRecord.uid, claims);
      return res.json({ success: true, uid: userRecord.uid, claims });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to set claims' });
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXORA HOTEL OS Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
