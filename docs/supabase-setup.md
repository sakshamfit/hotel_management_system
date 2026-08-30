# Supabase setup & deployment

This app runs entirely on **Supabase**: Postgres + Row Level Security (data),
Realtime (live updates), Supabase Auth (staff email/password + anonymous QR
guests), and Supabase Storage (images). There is no Firebase dependency left.

## 0. Before you start

There is no offline or demo backend — the app talks to Supabase for everything
(data, auth, realtime, storage). Until `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are set to real values, the browser shows a
**"Connect your Supabase project"** setup screen and every `/api/*` route
answers `503`. `GET /api/health` reports `"configured": false` in that state.

```bash
cp .env.example .env    # then fill in the three values
npm run dev             # http://localhost:3000
```

### Accounts and password recovery

- **Sign-in** is email + password against Supabase Auth. An address only works
  once it has a `profiles` row (`super_admin`, or `hotel_admin` with a
  `hotel_id`) — see §4. Signing in without one now reports
  *"no NEXORA role is provisioned for it yet"* on the login form instead of
  silently returning you to it.
- **Forgot password?** on the login screen emails a Supabase recovery link.
  `config.ts` sets `detectSessionInUrl: false`, so the app exchanges the link
  itself (both the implicit `#access_token=…&type=recovery` and PKCE
  `?code=…&type=recovery` shapes) and then shows the "choose a new password"
  panel. For this to land, your origin must be in
  **Auth → URL Configuration → Redirect URLs**.
- **Resending for a hotel admin**: the Super Admin console has a per-hotel
  reset action (`sendHotelPasswordReset`). Passwords are never stored or
  readable by the app.

## 1. Create the project

1. Create a Supabase project (supabase.com → New project). Note the project
   URL and database password.
2. **Authentication → Providers**:
   - Enable **Email** (staff log in with email/password; account creation is
     done by the super admin, so leave "Allow new users to sign up" off).
   - Enable **Anonymous sign-ins** (required for QR guest sessions).
   - Optionally enable **Google** for staff SSO.
   - **Authentication → URL Configuration**: add your deployed origin (and
     `http://localhost:3000` for dev) to **Redirect URLs**. Password-recovery
     links redirect back to `window.location.origin` and are rejected if the
     origin is not allow-listed.
3. **Project Settings → API**: copy the **Project URL**, the **anon public**
   key, and the **service_role** key (server only — never ship it).

## 2. Configure environment

Copy `.env.example` to `.env` and fill in:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

- `VITE_*` vars are bundled into the browser client (safe; RLS protects data).
- `SUPABASE_SERVICE_ROLE_KEY` is used only by `server.ts` (guest sessions,
  folio charges, admin user provisioning). It must **not** have the `VITE_`
  prefix.

## 3. Apply the database schema

With the Supabase CLI (or paste `supabase/migrations/0001_init.sql` into the
SQL editor and run it):

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push          # applies migrations
psql ... < supabase/seed.sql   # OPTIONAL: demo hotel/rooms/menu (local/fresh)
```

`0001_init.sql` creates every table, enables RLS, installs the staff/guest
helper functions and policies, creates the `create_booking` (double-booking
safe) and `post_guest_order_charge` (guest folio) RPCs, enables Realtime on the
tables the app streams, and creates the public `hotel-media` storage bucket.

### Local development (optional)

With Docker installed:

```bash
supabase start
supabase db reset        # applies migrations + supabase/seed.sql
```

Use the local URL/keys it prints in your `.env`.

## 4. Provision the first super admin

There are no custom claims — a staff role is a `profiles` row. After the schema
is applied:

```bash
npm run create-super-admin -- --email you@example.com
# or supply a password / env vars:
npm run create-super-admin -- --email you@example.com --password '...'
```

This creates (or reuses) the Auth user, confirms it, and writes
`profiles.role = 'super_admin'`. Sign in at the login screen. Hotel admins are
then created from the Super Admin dashboard (the server writes their Auth user
+ `profiles` row with the service-role key).

## Data model at a glance

| Concept | Table | Notes |
|---|---|---|
| Tenants | `hotels` | one row per hotel |
| Staff | `profiles` | `super_admin` (all hotels) or `hotel_admin` (`hotel_id`) |
| Guests (QR) | `guest_sessions` | anonymous auth user scoped to one room after token exchange |
| Inventory | `room_types`, `rooms` | rooms reference a room type + carry `permanent_token` |
| Contacts | `guests` | booking contacts |
| Stays | `bookings`, `room_nights`, `folios`, `charges`, `payments` | room_nights is the availability lock |
| F&B / service | `food_categories`, `food_items`, `service_categories`, `services`, `orders` | orders are also the room-service ticket stream |
| Misc | `notifications`, `audit_logs` | |

## Security model (replaces firestore.rules)

- All tables have **RLS enabled**.
- `is_staff()` / `is_super_admin()` / `staff_can_touch(hotel_id)` read the
  caller's `profiles` row; staff get full access scoped to their hotel.
- Anonymous guests are authorized by their `guest_sessions` row: they may read
  their own room, the hotel menu/services, and their own orders, and insert
  orders for their room. They never see bookings, guests, or folios.
- Privileged writes go through the Express server with the service-role key
  (guest token exchange, admin user creation) or through SECURITY DEFINER RPCs
  (`create_booking` is staff-only and atomic; `post_guest_order_charge` is
  guest-only and idempotent).
- Images live in the public `hotel-media` bucket; writes require staff.

## Realtime

The tables the UI streams (`hotels`, `rooms`, `room_types`, `guests`,
`bookings`, `folios`, `charges`, `orders`, `food_items`, `services`,
`notifications`, …) are added to the `supabase_realtime` publication by the
migration. The data service (`src/services/db.ts`) subscribes to
`postgres_changes` and re-runs the query on each change.

## Deploying

Build the client + server:

```bash
npm run build      # vite build (dist/) + esbuild server bundle (dist/server.cjs)
npm start          # serves dist/ and the /api routes
```

Set the same env vars in the host. The server listens on `PORT` (default 3000).
