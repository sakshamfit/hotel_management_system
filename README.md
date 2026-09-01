# NEXORA Hotel OS

Enterprise multi-tenant hotel operating system + in-room guest experience
(front desk, rooms & QR check-in, F&B, housekeeping, folios, feedback).

The **same codebase ships in two editions**:

| | Hosted (cloud) | Desktop (Offline) |
|---|---|---|
| Where it runs | your server | the hotel owner's Windows PC |
| Storage | Supabase Postgres + RLS + Realtime | embedded SQLite (`node:sqlite`) |
| Auth | Supabase Auth (email/password) | seller-issued username + password |
| Licensing | — | signed Ed25519 activation (offline) |
| Who buys it | hotel users (subscription) | hotel owners (like Marg) |

Both editions drive the identical React UI — only the data layer switches.

## Quick start

### Hosted edition (you are the platform owner)

```bash
cp .env.example .env        # fill Supabase keys + license keys
npm install
npm run db:push             # apply supabase/migrations
npm run create-super-admin -- --email you@example.com
npm run dev                 # http://localhost:3000
```

The Super Admin console now includes a **Desktop Licences** tab — "issue licence"
creates a signed activation + credentials, exactly what you send to a buyer.

### Desktop edition (buyer experience, simulated on any OS)

```bash
npm install
npm run keys:generate       # signing keypair → keys/ (git-ignored)
npm run license:issue -- --hotel "The Grand Palace" --owner "Rahul Sharma" \
    --username grandpalace --password "Palace@2026" --out /tmp/grandpalace.nexora

npm run dev:local           # offline-first app at http://localhost:3967
# → paste the activation string, enter grandpalace / Palace@2026 → done.
```

No internet needed. Data lives in `.nexora-data/` (or the OS app-data folder
in the packaged app).

### Build the Windows installer (Marg-style distribution)

```bash
npm run desktop:pack        # → desktop/release/NexoraHotelOS-Setup-1.0.0.exe
```

Drop the installer into `public/downloads/` (or set
`VITE_DESKTOP_DOWNLOAD_URL`) — the `/download` page on your site serves it.

See `docs/desktop-distribution.md` for the full distribution playbook and
`docs/supabase-setup.md` for the hosted setup.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `dev:local` | run hosted / offline edition |
| `npm run build` / `build:local` | bundle hosted / offline (SPA + server) |
| `npm run keys:generate` | create the Ed25519 license signing keypair |
| `npm run license:issue` | CLI: issue a signed desktop activation |
| `npm run smoke:local` | end-to-end offline backend test (activation → booking → guest order) |
| `npm run desktop:pack` | build the Windows NSIS + portable installer |
| `npm run lint` / `check:dates` | type-check / report validation |

## Tests

`npm run smoke:local` boots the offline server, issues a license, activates,
books a room, blocks double-booking, opens a guest QR session, places an order,
links it to the folio, verifies tenant isolation, and checks the realtime
stream.
