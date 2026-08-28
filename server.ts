import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, UserRecord } from 'firebase-admin/auth';
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
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      projectId: firebaseConfigJson.projectId,
      firestoreDatabaseId: firebaseConfigJson.firestoreDatabaseId,
    });
  });

  // Bootstrap Super Admin Endpoint
  // Allows setting up or setting custom claims for the master super_admin account
  app.post('/api/auth/bootstrap-super-admin', async (req: Request, res: Response) => {
    const { email = 'admin@raees.com', password = 'admin', name = 'Master Super Admin (Raees HQ)' } = req.body;
    const targetEmail = (email || '').toLowerCase().trim();

    try {
      let userRecord: UserRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(targetEmail);
      } catch (notFoundErr: any) {
        // User does not exist, create it
        userRecord = await adminAuth.createUser({
          email: targetEmail,
          password: password.length >= 6 ? password : 'admin123',
          displayName: name,
          emailVerified: true,
        });
      }

      // If user exists and a new password was provided (>= 6 chars), update password
      if (password && password.length >= 6) {
        try {
          await adminAuth.updateUser(userRecord.uid, { password });
        } catch (updateErr) {
          console.warn('Could not update password:', updateErr);
        }
      }

      // Assign Super Admin custom claim
      await adminAuth.setCustomUserClaims(userRecord.uid, {
        role: 'super_admin',
      });

      return res.json({
        success: true,
        message: `Super Admin account ${targetEmail} configured with super_admin claim.`,
        uid: userRecord.uid,
        email: userRecord.email,
        role: 'super_admin',
      });
    } catch (err: any) {
      console.error('Error bootstrapping Super Admin:', err);
      return res.status(500).json({ error: err.message || 'Failed to bootstrap Super Admin' });
    }
  });

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
      await adminAuth.deleteUser(userRecord.uid);
      return res.json({ success: true, message: `User ${email} deleted from Firebase Auth` });
    } catch (err: any) {
      // If user not found, treat as already deleted
      return res.json({ success: true, message: 'User not found or already deleted' });
    }
  });

  // Set Custom Claims Endpoint (Super Admin only)
  app.post('/api/admin/set-user-claims', requireSuperAdmin, async (req: Request, res: Response) => {
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
  });

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
