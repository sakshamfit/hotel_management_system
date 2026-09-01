/**
 * Local (offline) server host — used by:
 *   • the Electron desktop shell (bundled server-local.cjs)
 *   • `NEXORA_RUNTIME=local npm run dev` / `npm run start:local`
 *
 * Everything runs on the customer's machine: SQLite database + media folder in
 * `dataDir`, HTTP API on 127.0.0.1 (optional LAN bind for guest QR devices).
 */
import express, { type Express } from 'express';
import http from 'node:http';
import path from 'node:path';
import { LocalStore } from './store';
import { createLocalApi } from './api';
import { getPublicKeyPem } from './licensing';

export interface LocalServerOptions {
  /** Where nexora.db + media live (Electron: app.getPath('userData')). */
  dataDir: string;
  /** Built frontend (dist). When omitted, only the API is served (dev server middleware mode). */
  staticDir?: string;
  version?: string;
  demoAvailable?: boolean;
  port?: number;
}

export interface LocalServerHandle {
  app: Express;
  store: LocalStore;
  port: number;
  host: string;
  localUrl: string;
  setLanEnabled(enabled: boolean): Promise<void>;
  isLanEnabled(): boolean;
  close(): Promise<void>;
}

export function createLocalApp(opts: LocalServerOptions): { app: Express; store: LocalStore } {
  const store = new LocalStore(opts.dataDir);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(
    '/local/api',
    createLocalApi({
      store,
      version: opts.version || '1.0.0',
      demoAvailable: !!opts.demoAvailable,
    })
  );

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir, { index: 'index.html' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  return { app, store };
}

export async function startLocalServer(opts: LocalServerOptions): Promise<LocalServerHandle> {
  const { app, store } = createLocalApp(opts);
  const apiKey = getPublicKeyPem();
  if (!apiKey) {
    console.warn(
      '[local] No licence public key found (env LICENSE_PUBLIC_KEY, embedded constant or keys/license-signing-public.pem). ' +
        'Activation will refuse licenses until one is configured.'
    );
  }

  let host = process.env.NEXORA_LAN === '1' ? '0.0.0.0' : '127.0.0.1';
  const server = http.createServer(app);

  // LAN toggle for guest QR devices on the hotel Wi-Fi (staff only).
  app.post('/local/api/settings/lan', (req, res) => {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const staff = bearer ? store.getStaffByToken(bearer) : null;
    if (!staff) return res.status(401).json({ error: 'Unauthorized.' });
    setLanEnabledInternal(!!req.body?.enabled)
      .then(() => res.json({ ok: true, enabled: host === '0.0.0.0', localUrl: `http://${host}:${port}` }))
      .catch((err: any) => res.status(500).json({ error: err?.message || 'Could not toggle LAN mode.' }));
  });

  const listen = (): Promise<number> =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port ?? 0, host, () => {
        server.removeAllListeners('error');
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

  let port = await listen();

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        store.close();
        resolve();
      });
    });

  const setLanEnabledInternal = async (enabled: boolean): Promise<void> => {
    const nextHost = enabled ? '0.0.0.0' : '127.0.0.1';
    if (nextHost === host) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    host = nextHost;
    port = await listen();
  };
  const setLanEnabled = setLanEnabledInternal;

  return {
    app,
    store,
    port,
    host,
    localUrl: `http://127.0.0.1:${port}`,
    setLanEnabled,
    isLanEnabled: () => host === '0.0.0.0',
    close,
  };
}

/** Entry point used by the Electron main process (bundled CJS). */
export async function startFromMain(opts: {
  dataDir: string;
  staticDir: string;
  version?: string;
  port?: number;
}): Promise<LocalServerHandle> {
  return startLocalServer({ ...opts, demoAvailable: false });
}

// Allow `node dist/server-local.cjs` to boot standalone (dev convenience).
// NOTE: `npm run dev:local` boots the same backend through server.ts instead —
// this block is only for the standalone binary (and never triggers inside the
// Electron shell, where the server is started via startFromMain).
if (process.env.NEXORA_START_LOCAL_SERVER === '1') {
  const distPath = path.join(process.cwd(), 'dist');
  const dataDir = process.env.NEXORA_DATA_DIR || path.join(process.cwd(), '.nexora-data');
  const port = Number(process.env.PORT) || 3967;
  startLocalServer({
    dataDir,
    staticDir: distPath,
    port,
    version: process.env.npm_package_version || '1.0.0',
    demoAvailable: process.env.NODE_ENV !== 'production',
  })
    .then((srv) => {
      console.log(`[local] NEXORA HOTEL OS (offline) → ${srv.localUrl} (data: ${dataDir})`);
      console.log(`[local] Demo activation ${srv.store.isActivated() ? 'already used' : 'available'}`);
    })
    .catch((err) => {
      console.error('[local] Failed to start:', err);
      process.exit(1);
    });
}
