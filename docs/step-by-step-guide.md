# NEXORA Desktop Edition — Step-by-Step Guide (commands only)

Everything below was tested on this repo (Node v22). Copy each block in order.

---

## STEP 0 — Requirements

| What | Why |
|---|---|
| **Node.js 22+** | offline backend uses the built-in `node:sqlite` |
| **Windows PC** (or Windows CI) | only needed for **Step 5** (build the installer) |
| **Supabase project** | only needed for the **seller website** (Step 2/3) |
| **Git + npm** | install & run the project |

Check:

```bash
node --version   # v22.5.0 or higher
npm --version
```

---

## STEP 1 — Install the project once (any machine)

```bash
cd hotel_management_system
npm install
```

---

## STEP 2 — Generate your license signing keys (ONE TIME — keep them safe)

```bash
npm run keys:generate
```

This creates (both git-ignored):

- `keys/license-signing-private.pem` → **your secret**. Used to sign activations.
- `keys/license-signing-public.pem` → baked into the desktop app so it can
  verify activation codes **offline**.

The script also prints the public/private PEM. Copy the **public key** into
`server/local/licensing.ts` (`EMBEDDED_PUBLIC_KEY_PEM = "..."`) — or set it as
an env var when building (Step 5).

> ⚠️ Never commit `keys/`. Never send the private key to customers.

---

## STEP 3 — Seller website (only if you want the console to issue licenses)

The console lets you issue + download activations from the web instead of the CLI.

### 3.1 Create/connect Supabase (once)

1. Create a project at https://supabase.com → note **Project URL**, **anon key**, **service_role key**.
2. Copy the env template and fill it:

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
LICENSE_SIGNING_PRIVATE_KEY="<paste your private PEM from Step 2, or leave empty if keys/ file exists>"
LICENSE_PASSWORD_KEY="<any strong passphrase, 32+ characters, for re-sharing customer passwords>"
```

### 3.2 Apply the database schema

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

`db:push` applies all migrations including `0003_desktop_licenses.sql`
(the desktop licence registry + Super-Admin-only RLS).

### 3.3 Create your first Super Admin account

```bash
npm run create-super-admin -- --email you@example.com
```

### 3.4 Run the seller site

```bash
npm run dev
# open http://localhost:3000 → sign in → Super Admin → "Desktop Licences" tab
```

---

## STEP 4 — Test the whole flow locally (works on any OS, before packaging)

### 4.1 Automated end-to-end test (no browser)

```bash
npm run smoke:local
# expect: ✔ SMOKE TEST PASSED — offline backend works end to end.
```

### 4.2 Manual test — act like the buyer

Terminal A — start the offline app:

```bash
npm run dev:local
# → NEXORA HOTEL OS (Desktop Edition, offline) running at http://localhost:3967
```

Terminal B — issue a license for a fake customer (CLI):

```bash
npm run license:issue -- \
  --hotel "The Grand Palace" \
  --owner "Rahul Sharma" \
  --username grandpalace \
  --password "Palace@2026" \
  --out /tmp/grandpalace.nexora
```

Now open **http://localhost:3967** in your browser:

1. Click **"I have an activation"**
2. Paste the activation string it printed (or upload the .nexora file)
3. Username: `grandpalace` · Password: `Palace@2026`
4. → Dashboard opens. Add a room, create a booking — everything is stored in
   `.nexora-data/` on your machine.

---

## STEP 5 — Build the Windows installer (do this on Windows)

```bash
npm run build:local        # compiles the offline edition (SPA + server)
npm run desktop:pack       # electron-builder → NSIS + portable
```

Output:

```
desktop/release/NexoraHotelOS-Setup-1.0.0.exe      ← send/upload this
desktop/release/NexoraHotelOS-Setup-1.0.0-portable.exe
```

If you didn't edit `licensing.ts`, bake the public key at build time instead:

```powershell
$env:LICENSE_PUBLIC_KEY = Get-Content keys/license-signing-public.pem -Raw
npm run desktop:pack
```

### Upload to your site (so buyers can download it)

Option A — static file in this repo:

```bash
cp desktop/release/NexoraHotelOS-Setup-1.0.0.exe public/downloads/
```

Option B — CDN link:

```bash
# set in .env and rebuild the site
VITE_DESKTOP_DOWNLOAD_URL=https://cdn.example.com/NexoraHotelOS-Setup-1.0.0.exe
```

The public page at **`/download`** (linked from the sign-in screen) uses this.

---

## STEP 6 — Issue a real license (pick ONE)

### A. From the seller website

1. Sign in as Super Admin → **Desktop Licences** → **Issue licence**.
2. Enter hotel/owner, **username**, **password** (or click Generate), expiry.
3. Click **Issue licence** → copy the **activation string** + **username + password**,
   and/or download the **.nexora file**.
4. Send those to the buyer (WhatsApp / email / paper).

### B. From the CLI (no website needed)

```bash
npm run license:issue -- \
  --hotel "Sharma Residency" \
  --owner "Anita Sharma" \
  --username sharmaresidency \
  --password "Residency@2026" \
  --email owner@sharma.com \
  --expires 2027-12-31 \
  --out /tmp/sharma.nexora
```

---

## STEP 7 — The buyer's steps (what you send them)

> 1. Go to your site → **Download** → install `NexoraHotelOS-Setup-1.0.0.exe`
> 2. Open **NEXORA Hotel OS** (desktop shortcut)
> 3. On first run: paste the **activation string** (or choose the .nexora file)
> 4. Enter **username** + **password** you sent → done.
>
> Everything runs on their PC. No internet needed after setup. Backups: copy
> the app's data folder, or use the backup option in Settings.

---

## STEP 8 — Useful daily operations

| Task | Command / place |
|---|---|
| See all issued licenses | Seller site → **Desktop Licences** tab |
| Re-share a password | Licences tab → eye icon (needs `LICENSE_PASSWORD_KEY` set at issue time) |
| Mark a license used | Licences tab → ✓ (status → activated) |
| Revoke a license | Licences tab → 🚫 (records only — offline copies keep working) |
| Offline CLI license | `npm run license:issue -- --help`-style args (see flag list) |
| Run offline app (any OS) | `npm run dev:local` → http://localhost:3967 |
| Run only offline server | `npm run start:local` (serves `dist/` in production mode) |
| Health check | `curl http://localhost:3967/local/api/health` |
| Reset demo data | delete the `.nexora-data/` folder |
| Type-check | `npm run lint` |

### `license:issue` flags

| Flag | Required | Meaning |
|---|---|---|
| `--hotel` | ✅ | Hotel name |
| `--owner` | ✅ | Owner name |
| `--username` | ✅ | Login username (lowercase, no spaces) |
| `--password` | ✅ | Login password (min 8 chars) |
| `--email` | | Customer email (optional) |
| `--expires` | | `YYYY-MM-DD` (optional expiry) |
| `--out` | | File to save the .nexora activation (use `none` to skip) |

---

## Gotchas

- **Port 3967 busy?** Use `PORT=4000 npm run dev:local`.
- **"No licence public key" at activation:** put the public PEM in
  `EMBEDDED_PUBLIC_KEY_PEM` in `server/local/licensing.ts` and rebuild.
- **Buyer reinstalls on a NEW PC:** the activation data folder is new, so the
  same credentials work again only if signed for reuse — simplest is to issue
  a fresh license for the replacement machine.
- **Forgot buyer password:** issue a new license with new credentials (or set
  `LICENSE_PASSWORD_KEY` *before* issuing so you can recover it later).
