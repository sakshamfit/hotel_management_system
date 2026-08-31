# Desktop Edition — Marg-style distribution playbook

Buyers download the software from your site, install it on **their** computer,
and you send them **credentials** (username + password) that unlock their copy.
The hotel's data never leaves their machine.

```
YOU (seller)                                   CUSTOMER (hotel owner)
┌─────────────────────────────┐                ┌──────────────────────────────┐
│ website /download  ─────────┼──installer──▶ │ 1. Install NexoraHotelOS.exe   │
│ Seller Console (this app)   │                │                               │
│  · issue licence ───────────┼─activation──▶ │ 2. Paste activation string    │
│  · share username/password ─┼─credentials─▶ │ 3. Sign in → hotel created    │
│  (Ed25519 private key)      │                │    SQLite DB on their disk    │
└─────────────────────────────┘                └──────────────────────────────┘
        offline activation — the desktop app verifies a SIGNED payload locally
```

## 1. Generate your signing keys (once)

```bash
npm run keys:generate
```

This writes (both git-ignored):

- `keys/license-signing-private.pem` — **never** commit/ship. Used by the seller
  site (or the CLI) to sign activations.
- `keys/license-signing-public.pem` — bake into the desktop build so it can
  verify activations with no internet. Options:
  1. paste it as `EMBEDDED_PUBLIC_KEY_PEM` in `server/local/licensing.ts`, or
  2. build with `LICENSE_PUBLIC_KEY="$(cat keys/license-signing-public.pem)"`.
  Also set the same PEM as `LICENSE_PUBLIC_KEY` when running the hosted site
  (or rely on the keys/ file).

⚠️ Regenerating keys after selling copies will invalidate old activation
strings. Keep the private key safe.

## 2. Issue an activation (two ways)

### A. Seller Console (website, cloud mode)

1. Sign in as Super Admin → **Desktop Licences** tab → **Issue licence**.
2. Enter hotel name, owner, username + password (or "Generate"), optional
   expiry.
3. The server signs the payload and shows:
   - licence code (record-keeping),
   - **username + password** (shown once; also recoverable later — encrypted
     with `LICENSE_PASSWORD_KEY` in `.env`),
   - the **activation string** (one long line) + a **.nexora file** download.
4. Send the buyer: activation string (or .nexora file) + username + password —
   by WhatsApp, email, or on paper. That *is* the hand-over.

### B. CLI (no website needed — works offline, great for a small distributor)

```bash
npm run license:issue -- \
  --hotel "The Grand Palace" --owner "Rahul Sharma" \
  --username grandpalace --password "Palace@2026" \
  --expires 2027-12-31 --out grandpalace.nexora
```

Prints everything and writes the .nexora file.

## 3. Build the installer

```bash
npm install          # installs electron + electron-builder (Windows build machine)
npm run desktop:pack # → desktop/release/NexoraHotelOS-Setup-1.0.0.exe (+ portable .exe)
```

The package contains:

- `dist/` — the React app compiled with `VITE_RUNTIME=local` (offline edition),
- `dist/server-local.cjs` — the embedded offline server (SQLite + licensing),
- `desktop/main.cjs` — Electron shell: boots the server on a free localhost
  port and opens the app window.

> Build on Windows (or a CI Windows runner) for the native installer.
> `asarUnpack: dist/**` is already configured so express can serve the files;
> the SQLite database itself always lives in `%APPDATA%/nexora-hotel-os/
> nexora-data`, never inside the app.

### Put the installer on your site

- Drop `NexoraHotelOS-Setup-1.0.0.exe` into `public/downloads/`, or
- set `VITE_DESKTOP_DOWNLOAD_URL` to a CDN link and rebuild.

The public page at `/download` (linked from the login screen) does the rest.

## 4. The buyer's experience

1. Opens `/download`, clicks **Download installer (Windows)**.
2. Installs (next-next-finish, no terminal, no admin? — NSIS installs per-user;
   no database installs, nothing else needed).
3. **First run** → activation wizard:
   - paste the activation string (or choose the .nexora file),
   - enter username + password from the seller,
   - NEXORA verifies the Ed25519 signature **locally**, creates the hotel +
     owner account, and opens the sign-in → dashboard.
4. Owner runs the hotel normally (rooms, QR codes, F&B, housekeeping, folios).
   Guest phones on the hotel Wi-Fi can open the room QR portal: enable **LAN
   mode** (`NEXORA_LAN=1` in the build, or the Settings toggle) so the app
   listens on 0.0.0.0 and prints QR codes that point to
   `http://<pc-ip>:<port>/?token=...`.

## 5. Security model / what to expect

| Property | How |
|---|---|
| Activation can't be copied | payload includes username + password **scrypt hash**; both must match, and the signature is checked before anything is written |
| Replay / re-activation | one activation per data folder; re-installing on a NEW machine with the same credentials works only if the seller re-issues (or you keep a spare) |
| Revocation | offline by design (like Marg) — marking a licence `revoked` stops future issues/records; already-activated copies keep working until the customer is contacted |
| Customer passwords | never kept in plaintext by the desktop app (only the scrypt hash inside the signed payload); the seller's console stores an AES-GCM encrypted copy (`LICENSE_PASSWORD_KEY`, 32+ chars) so it can re-share |
| Expiry | optional; enforced at activation time (the payload carries `expiresAt`) |

## 6. Operations

- **Demo/dev**: `npm run dev:local` enables a demo activation button in the
  wizard (never present in `NODE_ENV=production` builds).
- **Automated test**: `npm run smoke:local` — proves activation, booking
  conflict lock, guest QR session, order→folio charge, tenant isolation,
  backups, and realtime events.
- **Backups**: The owner can copy `.nexora-data/` (or use the backup button in
  the app Settings) — database + photos in one folder.
- **Password lost**: the seller re-issues the same credentials from the console
  ("credentials" action) — the desktop app can also change the password from
  Settings once signed in (offline).

## 7. Files that matter

| File | Role |
|---|---|
| `server/local/licensing.ts` | Ed25519 sign/verify, activation string format |
| `server/local/store.ts` | SQLite actions + RPCs + scrypt auth |
| `server/local/api.ts` | `/local/api` HTTP surface (staff Bearer / guest X-Guest-Token) |
| `server/local/index.ts` | hosts the offline server (dev, standalone, Electron) |
| `src/services/local/localApi.ts` | browser client for the offline backend |
| `src/services/db.ts` | the Supabase↔local dispatch seam |
| `desktop/main.cjs`, `preload.cjs`, `icon.png` | Electron shell |
| `scripts/issue-license.ts`, `generate-license-keys.ts` | seller CLI |
| `supabase/migrations/0003_desktop_licenses.sql` | licence registry (seller console) |
