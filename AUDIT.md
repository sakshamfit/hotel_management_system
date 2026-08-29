# NEXORA HOTEL OS — Pre-Rebuild Audit

> **Note:** §1–§10 below describe the repository as it was audited at `a2965db`.
> The four security fixes agreed immediately afterwards are recorded in
> [§11 Remediation log](#11-remediation-log-security-fixes-1-4) at the end.
> Items in §7 marked 🔴 for the bootstrap credentials, the open bootstrap route
> and the `/users` rule are now resolved; the rest of §7 is untouched.

Repo: `sakshamfit/hotel_management_system` · branch `arena/01a04c41-hotel-management-system`
Audited at commit `a2965db` ("Superhumon retheme, Firebase Storage image uploads, super-admin bootstrap & secure hotel credentials").

**One-line verdict:** this is a polished, working *guest-request / room-service* app with real multi-tenant plumbing — **not** a PMS. There is no reservation engine, no rate or availability model, no folio/billing, and no real staff roles. Roughly 60% of the surface area is production-viable; the "booking" domain is dead code, and the guest QR portal cannot work for an actual guest (see §5, §7).

Verified during the audit: `npx tsc --noEmit` passes clean, `npm run build` succeeds (1.17 MB JS bundle, no code splitting), and `npm run dev` boots on port 3000 with a healthy `/api/health`.

---

## 1. Folder structure

```
hotel_management_system/
├── server.ts                      259 lines — Express + Vite middleware + Firebase Admin
├── index.html
├── vite.config.ts                 React + Tailwind v4 plugin, allowedHosts: true
├── tsconfig.json                  strict-ish, @/* → ./*
├── package.json                   name is still "react-example" (AI Studio leftover)
│
├── firebase-applet-config.json    ← Firebase web config, committed (see §8)
├── firebase-blueprint.json        130 lines — AI Studio data-model artifact (drifted, see §7)
├── firestore.rules                71 lines
├── storage.rules                  55 lines
├── metadata.json                  AI Studio applet metadata
├── .env.example                   2 vars, neither is read anywhere (see §8)
│
├── public/
│   └── hero-portrait.jpg          122 KB login-page hero. No favicon, no manifest, no PWA.
│
├── assets/.aistudio/.gitignore    AI Studio scratch dir marker (`*`)
│
└── src/                           8,392 lines total across 23 files
    ├── main.tsx                   React 19 root, StrictMode
    ├── App.tsx                    Top-level experience switch (login / super_admin / hotel_os / guest)
    ├── index.css                  205 lines — Tailwind v4 @theme design tokens ("Superhumon" system)
    ├── types.ts                   302 lines — all domain interfaces
    │
    ├── firebase/
    │   └── config.ts              Firebase app/auth/firestore/storage init
    │
    ├── context/
    │   └── AuthContext.tsx        314 lines — session, role resolution, tenant switching
    │
    ├── services/
    │   ├── firestoreService.ts    575 lines — every Firestore read/write in the app
    │   ├── storageService.ts      129 lines — image upload/validate/delete
    │   └── superAdminBootstrap.ts 121 lines — one-time first-admin creation
    │
    ├── utils/
    │   └── qr.ts                  19 lines — qrcode → data URL
    │
    └── components/
        ├── auth/          LoginPage.tsx
        ├── common/        Header.tsx · ImageUploader.tsx · NewOrderAlertCenter.tsx
        ├── guest/         GuestRoomView.tsx
        ├── hotel-admin/   HotelAdminLayout.tsx + 9 tab components
        └── super-admin/   SuperAdminDashboard.tsx · CreateHotelWizardModal.tsx
```

There is **no router**. Navigation is `useState` string switching (`activeExperience`, `activeTab`), so no URL is shareable except the guest `?token=` query param.

---

## 2. Component / page inventory (18 components)

### Shell & shared

| Component | Lines | What it does |
|---|---|---|
| `App.tsx` | 72 | Wraps everything in `AuthProvider`; picks login / `super_admin` / `hotel_os` / `guest_experience` based on auth state + `?token=` in the URL. |
| `main.tsx` | 10 | React 19 `createRoot` + `StrictMode`. |
| `context/AuthContext.tsx` | 314 | The real brain: Firebase Auth subscription, role resolution (Firestore doc → custom claim fallback), hotel tenant selection, login/logout, real-time hotel subscriptions. |
| `common/Header.tsx` | 125 | Sticky bar with hotel logo/name/code, live clock in the hotel's timezone, "Back to Super Admin HQ", profile chip, sign out. |
| `common/ImageUploader.tsx` | 248 | Dual-mode (immediate/deferred) drag-drop image uploader with 5 MB + MIME validation, progress bar, preview, delete. |
| `common/NewOrderAlertCenter.tsx` | 553 | Global new-order notifier: subscribes to `docChanges()` across all hotels, plays a Web Audio siren + `speechSynthesis` announcement, toast stack + dismissible queue. |

### Auth

| Component | Lines | What it does |
|---|---|---|
| `auth/LoginPage.tsx` | 302 | Split-screen marketing/login page: email+password form, Google sign-in button, Firebase error-code mapping (incl. a special "Identity Toolkit API not enabled" sandbox banner). |

### Super admin (platform owner)

| Component | Lines | What it does |
|---|---|---|
| `super-admin/SuperAdminDashboard.tsx` | 401 | Tenant list with search + status filter, KPI cards, per-hotel actions: Launch Hotel OS, send password-reset email, delete tenant (+ cascade delete of subcollections, Storage folder, and the Firebase Auth user). |
| `super-admin/CreateHotelWizardModal.tsx` | 809 | 4-step wizard: property details → branding (colours + logo/cover upload) → 17 module toggles → hotel admin credentials; creates hotel doc, uploads branding, creates the Firebase Auth user, then reveals the password once with confetti. |

### Hotel admin (9 tabs, hosted by `HotelAdminLayout`)

| Component | Lines | What it does |
|---|---|---|
| `hotel-admin/HotelAdminLayout.tsx` | 148 | Indigo sidebar + 9-tab shell; renders `<NewOrderAlertCenter>`; empty state when no tenant is selected. |
| `hotel-admin/HotelDashboardTab.tsx` | 327 | KPI dashboard: occupancy %, active/completed orders, F&B vs service revenue, top items, low-stock-ish quick links. Everything derived client-side from live `rooms` + `orders`. |
| `hotel-admin/LiveRequestsTab.tsx` | 299 | Master request board — search, Active/All/Completed filters, per-card Accept & Prepare → Mark Completed → Cancel. |
| `hotel-admin/KitchenDisplayTab.tsx` | 166 | KDS chef screen for `type === 'food'` tickets: Mark Food Ready → Delivered to Room, with a chime toggle. |
| `hotel-admin/HousekeepingTab.tsx` | 205 | Housekeeping queue — filters `orders` by `type === 'service'` **or** regex on instructions/items (`clean|towel|water|toiletr|linen|housekeep|pillow`); Mark Room Serviced. |
| `hotel-admin/RoomsAndQrTab.tsx` | 420 | Room CRUD: bulk-create N rooms (sequential numbers), per-room permanent QR generation/download, room photo upload, room delete. |
| `hotel-admin/GuestCheckinTab.tsx` | 337 | Front desk: check-in modal (room + guest name/phone/email + expected check-out date) and check-out with confirm dialog. **This is the entire "booking" system** (see §4). |
| `hotel-admin/FoodMenuTab.tsx` | 489 | Menu CRUD with veg/non-veg flag, prep time, availability toggle, dish photo upload to Storage. |
| `hotel-admin/ServicesTab.tsx` | 371 | Service catalogue CRUD (name, category, price, SLA minutes, availability toggle). |
| `hotel-admin/DailyReportsTab.tsx` | 189 | 24h report: revenue, order counts, top items, occupancy, avg completion time, audit metadata; print button (`window.print`). |

### Guest

| Component | Lines | What it does |
|---|---|---|
| `guest/GuestRoomView.tsx` | 724 | The QR-scanned in-room portal: resolves room by `permanentToken`, browses menu (category + veg filters), cart with variants-free qty, places food orders and service requests, tracks order status. |

---

## 3. Firebase usage

### Services wired up

| Service | Status | Notes |
|---|---|---|
| **Firebase Auth** | ✅ used | Email/password + Google popup. No anonymous, no phone, no email-link. |
| **Cloud Firestore** | ✅ used | Named (non-default) database: `ai-studio-nexorahotelos-ec6f5ef3-...`. |
| **Firebase Storage** | ✅ used | Tenant-scoped image tree. |
| **Cloud Functions** | ❌ none | Deliberately avoided (free-tier); replaced by the Express server. |
| **FCM / Cloud Messaging** | ❌ none | "Notifications" module flag is decorative; in-app alerts are Web Audio + speech only. |
| **Analytics / App Check / Extensions / Hosting** | ❌ none | |

### Collections and data shapes

**Root collection: `users/{uid}`** — the primary role source (free-tier substitute for custom claims).

```ts
{ role: 'super_admin' | 'hotel_admin', hotelId: string|null, email: string,
  displayName: string, phone: string, createdAt: ISO string | serverTimestamp }
```
Written by: (a) the Admin SDK server endpoint, (b) the client-side secondary-app signup, (c) the one-time bootstrap. Publicly readable in rules (required so the pre-login bootstrap can check whether a super admin exists) — a deliberate but notable trade-off.

**Root collection: `hotels/{hotelId}`** — tenant root. ID format `hotel_{code}_{base36 timestamp}`.

```ts
{ name, legalName, hotelCode, address, city, state, country, postalCode,
  phone, email, ownerName?, ownerPhone?, ownerWhatsApp?,
  currency: 'INR'|'USD'|'AED'|'EUR', currencySymbol: '₹'|'$'|'AED '|'€',
  timezone, status: 'active'|'trial'|'suspended'|'SUSPENDED'|'ACTIVE'|'TRIAL',
  loginEmail,                       // admin login, for display/reset only
  branding: { logoUrl, coverImageUrl, primaryColor, secondaryColor,
              accentColor, welcomeMessage, fontFamily },
  modules: { /* 17 booleans */ },
  roomsCount, adminCredentials: { name, email },   // password deliberately NOT stored
  createdAt, updatedAt }
```

**Subcollection: `hotels/{hotelId}/rooms/{roomId}`**

```ts
{ roomNumber: string, floor: number, roomType?, type?, capacity?: number,
  status: 'available'|'occupied'|'maintenance'|'cleaning'|'VACANT'|'OCCUPIED',
  permanentToken: string,           // `qr_{hotelId}_rm{num}_{base36 ts}` — the QR identity
  photoUrl?: string, activeGuestSessionId?: string|null,
  guestName?, guestPhone?, guestEmail?,    // ← current stay lives ON THE ROOM
  checkedInAt?, expectedCheckout?, lastCheckedOutAt?,
  createdAt, pricePerNight?: number }      // pricePerNight written via `as any`, never read
```

**Subcollection: `hotels/{hotelId}/orders/{orderId}`** — the workhorse; food **and** service requests share it.

```ts
{ roomNumber, guestName, type: 'food'|'service',
  items: [{ name, quantity, price, variantName? }],
  totalAmount, status: 'PENDING'|'NEW'|'IN_PROGRESS'|'ACCEPTED'|'READY'|'COMPLETED'|'CANCELLED',
  instructions, createdAt: ISO string, updatedAt?, completedAt? }
```
Also declared on the `ServiceRequest` type but **never written by any code path**: `roomId`, `guestSessionId`, `guestPhone`, `serviceId`, `serviceName`, `priority`, `assignedStaffId/Name`, `estimatedDeliveryMinutes`, `receptionConfirmed`, `callConfirmed*`, `specialNotes`, `statusNote`, `guestFeedback`.

**Subcollection: `hotels/{hotelId}/foodItems/{itemId}`**

```ts
{ categoryId, category, name, description, basePrice, price,   // price duplicated
  isVegetarian, isVeg,                                        // flag duplicated
  dietary?, imageUrl?, isAvailable,
  prepTimeMinutes, preparationTimeMinutes,                    // duplicated
  variants?: [{ id, name, price }],                           // type exists, no UI
  createdAt }
```

**Subcollection: `hotels/{hotelId}/services/{serviceId}`**
```ts
{ categoryId, name, description, price, slaMinutes, estimatedTimeMinutes, isAvailable, createdAt }
```

**Subcollection: `hotels/{hotelId}/bookings/{bookingId}`** — **declared and never used.** See §4.
Intended shape (`GuestSession`): `roomId, roomNumber, guestName, guestPhone, guestEmail?, guestCount?, checkInTime, expectedCheckOutTime, actualCheckOutTime, status: 'active'|'completed'`.

**Referenced but non-existent:** `staff` (only appears in the `deleteHotelDoc` cleanup array) and the blueprint's `qrCodeToken` field.

**Types with no collection at all:** `ServiceCategory`, `FoodCategory`, `InAppNotification`, `AuditLog`, `DailyReportData` (computed client-side, never persisted), `Hotel.legalName/ownerName/ownerPhone/ownerWhatsApp` (never populated by the wizard).

### Storage layout

```
hotels/{hotelId}/branding/logo.{jpg|png|webp}
hotels/{hotelId}/branding/cover.{jpg|png|webp}
hotels/{hotelId}/menu/{itemId}/image.{ext}
hotels/{hotelId}/rooms/{roomId}/image.{ext}
hotels/{hotelId}/profile/{userId}/image.{ext}   ← documented in storage.rules, never implemented
```
Validation: JPEG/PNG/WebP only, ≤ 5 MB, enforced both client-side (`storageService.validateImageFile`) and in `storage.rules`.

### Security rules

- `firestore.rules`: helpers read `users/{uid}` doc as the primary role source and custom claims as fallback; `hotels/{id}/**` gated on `isSuperAdmin() || isHotelAdminOf(hotelId)`; default deny. Reasonable for the current 2-role model — but note the blanket `allow read, write` on **any** subcollection name, and that `read: if true` on `users` exposes every admin's email to any visitor (unauthenticated? no — `isAuthenticated()` is required for hotels; `users` is `allow get, list: if true`, i.e. genuinely world-readable including unauthenticated).
- `storage.rules`: **custom claims only** — it does not check the Firestore `users/{uid}` doc. On Spark (free) plan where claims may not be attached, hotel-admin uploads will be denied even though Firestore access works. This is an asymmetry bug.

---

## 4. Booking / reservation logic — the headline finding

**There is no booking engine.** What exists:

1. **Check-in** (`GuestCheckinTab.handleCheckIn`) does not create a booking. It patches the **room document**:
   ```ts
   updateRoom(hotelId, roomId, { status: 'occupied', guestName, guestPhone,
                                 guestEmail, checkedInAt, expectedCheckout })
   ```
2. **Check-out** patches the same room back to `status: 'available'` and blanks the guest fields, setting `lastCheckedOutAt`. **No stay record, no folio, no invoice, no payment, no history is produced.**
3. `firestoreService.createBooking()`, `checkOutGuest()` and `subscribeBookings()` **exist but have zero call sites** anywhere in `src/` (verified by grep). They are the skeleton of a `hotels/{id}/bookings` design that was never wired to the UI. The `bookings` collection is therefore always empty in practice.

### Conflict / double-booking checks

**None. Anywhere.** Concretely:

- No date-range field is queried. `expectedCheckout` is a bare `YYYY-MM-DD` string stored on the room and never read for conflict logic — it's only displayed.
- No availability calendar, no per-date inventory, no room-type allocation, no overbooking threshold.
- The only guard is `vacantRooms = rooms.filter(status === 'available' | 'vacant' | 'VACANT')` in the check-in dropdown. That filter is **case-fragile**: the `RoomStatus` union carries both `available` and `VACANT`/`OCCUPIED` variants because the enum was widened mid-project (`| string` on `RoomType` too). A room in `cleaning` or `maintenance` appears in **neither** the vacant nor the occupied list — it silently disappears from the front desk.
- Two staff members checking in simultaneously will both write `status: 'occupied'` to the same room; there is no transaction, no `runTransaction`, no `writeBatch`, and no server-side validation. Last write wins.

### Order status state machine

Also worth flagging: there is no single status machine. Three components write overlapping, inconsistent values:

| Writer | Statuses it writes |
|---|---|
| Guest portal | `PENDING` (not in the `RequestStatus` union — it typechecks only because the union ends in `\| string`) |
| Live Requests | `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| Kitchen KDS | `READY`, `COMPLETED` |
| Housekeeping | `COMPLETED` |
| Types-only, never written | `NEW`, `ACCEPTED`, `PREPARING`, `DELIVERING`, `received`, `accepted`, … |

Every consumer defensively `toUpperCase()`s and compares against ad-hoc arrays (`['COMPLETED','DELIVERED','CANCELLED']`), because `'DELIVERED'` is filtered for but never written. This will bite you during the rebuild — normalise it into one enum + one transition table.

---

## 5. Auth

**Provider:** Firebase Auth (email/password + Google `signInWithPopup`).

**Roles:** effectively **two**.

| Role | How granted | Where enforced |
|---|---|---|
| `super_admin` | Custom claim via Admin SDK at `/api/admin/create-hotel-user` / `bootstrap-super-admin`, **or** `users/{uid}.role` doc | `server.ts` middleware (claims only), `firestore.rules`, `AuthContext` |
| `hotel_admin` | Same, plus `hotelId` | `firestore.rules`, `storage.rules` (claims only), `AuthContext` |

The `UserRole` type lists eight roles — `SUPER_ADMIN, HOTEL_ADMIN, HOTEL_OWNER, RECEPTIONIST, KITCHEN_STAFF, HOUSEKEEPING_STAFF, MAINTENANCE_STAFF` — but **none of the last six is ever assigned, persisted, or checked**. `AuthContext.processUserClaims()` normalises everything that isn't `super_admin` into `hotel_admin`. They are decorative.

**Resolution flow** (`AuthContext.processUserClaims`):
1. Force-refresh the ID token, read `claims.role` / `claims.hotelId`.
2. Read `users/{uid}` from Firestore — this **wins** over the claim.
3. If no role yet, wait 600 ms and retry (claim propagation hack).
4. If the email is the bootstrap email and still unroled, call `/api/auth/bootstrap-super-admin` and re-read.
5. If still no role → `signOut()` and bounce to login. (Fail-closed, correctly.)

**Hotel-admin provisioning** uses a clever free-tier trick: a **secondary, temporary Firebase app instance** (`initializeApp(firebaseConfig, appName)`) creates the Auth user so the Super Admin's own session isn't clobbered, writes `users/{uid}`, signs out of the secondary app, then `deleteApp()`. If that fails it falls back to the Admin-SDK endpoint. Password reset uses `sendPasswordResetEmail`. Passwords are never persisted to Firestore — that part is done right.

**Gaps:**

- 🔴 **Guests have no authentication at all.** `signInAnonymously` appears nowhere. `firestore.rules` requires `request.auth != null` and a hotel-admin/super-admin role for `hotels/{id}/**`, so a real guest scanning a room QR code is **denied every read and write**. The guest portal currently only works because an admin is already signed in (`?token=` keeps `activeExperience` in guest mode while the admin session is live). This is the single biggest functional blocker in the app.
- 🔴 The `users` collection is `allow get, list: if true` — world-readable, including to unauthenticated callers.
- 🟠 `requireSuperAdmin` in `server.ts` checks `decodedToken.role` (custom claim) **only**. A super admin whose role lives solely in the Firestore doc (the primary path on Spark) gets a 403 from every `/api/admin/*` route.
- 🟠 No per-hotel staff accounts, no shift handover, no audit trail of who accepted/completed an order.
- 🟠 Google sign-in is offered to everyone; a Google-authenticated user without a `users/{uid}` doc is signed out — fine, but there's no "request access" path.

---

## 6. `server.ts` — what the Express server actually does

259 lines. In dev it runs Vite in **middleware mode**; in production it serves `dist/` with an SPA catch-all. Listens on a hardcoded **port 3000**, bound to `0.0.0.0`. Initialises the **Firebase Admin SDK** with `projectId` only (relies on Application Default Credentials) — so it works in the AI Studio sandbox but needs `GOOGLE_APPLICATION_CREDENTIALS` anywhere else.

| Method | Route | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | none | Returns status, projectId, Firestore DB id. Useful smoke test. |
| POST | `/api/auth/bootstrap-super-admin` | ⚠️ **none** | Creates (or finds) the bootstrap super-admin Auth user, optionally sets a password, attaches the `super_admin` claim. Pinned to one hardcoded email — any other address gets 403. |
| POST | `/api/admin/create-hotel-user` | `requireSuperAdmin` | Creates or updates a hotel admin Auth user, sets claims `{ role:'hotel_admin', hotelId }`, merges the `users/{uid}` doc. |
| POST | `/api/admin/delete-hotel-user` | `requireSuperAdmin` | Deletes the `users/{uid}` doc (best effort) then the Auth user. Swallows "not found" as success. |
| POST | `/api/admin/set-user-claims` | `requireSuperAdmin` | Sets arbitrary `{ role, hotelId }` claims by email. **No client caller** — an orphan admin utility. |
| GET | `*` (prod only) | — | Serves `dist/index.html` SPA fallback. |

`requireSuperAdmin` = `verifyIdToken` → `decodedToken.role === 'super_admin'` → else 403.

**Hardening absent:** no rate limiting (the unauthenticated bootstrap route is hammerable), no request body size limit, no CORS policy, no helmet, no structured logging, no central error middleware (every handler has its own try/catch), no CSRF, and **no audit log** despite `AuditLog` existing in `types.ts`.

Also note: `firestore.rules` and `storage.rules` sit at the repo root but there is **no `firebase.json`**, so rule deployment is unconfigured — they're currently documentation, not enforced infrastructure.

---

## 7. Hardcoded, unfinished, and placeholder findings

### 🔴 Critical

1. **Live credentials committed to git.** `src/services/superAdminBootstrap.ts`:
   ```ts
   export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'ra7650384@gmail.com';
   const BOOTSTRAP_SUPER_ADMIN_PASSWORD = '9852120609';
   ```
   This ships inside the client bundle. Anyone can read it from the JS. `server.ts` hardcodes the same email plus a fallback password `'admin123'`, and the bootstrap endpoint will happily **reset that account's password** to any ≥6-char value from an unauthenticated POST (it's email-pinned, so the blast radius is one account — but that account is god-mode). **Move to env vars / a Cloud Function before anything else.**
2. **Guest portal is unusable by guests** (no anonymous auth, see §5).
3. **Booking domain is dead code** — `createBooking` / `checkOutGuest` / `subscribeBookings` have no callers; the `bookings` collection is never populated.

### 🟠 Significant

4. **Full Firebase web config committed** in `firebase-applet-config.json`, including the API key and the AI Studio–provisioned named Firestore DB (`ai-studio-nexorahotelos-ec6f5ef3-...`). Web API keys are public by design, but the DB id hard-binds this build to a sandbox project.
5. **Module toggles do nothing.** All 17 `HotelModules` flags (`guestQrSystem`, `housekeeping`, `spaAndWellness`, `analytics`, `autoDailyReset`, `requireCallConfirmation`, …) are persisted by the wizard and **never read again**. Every tab renders for every hotel.
6. **Hotel profile is write-once.** No UI to edit hotel details, branding, status, or modules after creation — `updateHotelDoc` is only called during wizard image upload. `hotel.legalName`, `ownerName`, `ownerPhone`, `ownerWhatsApp`, `capacity`, `roomsCount` (never updated when rooms are added/deleted).
7. **Room status can only be `available` or `occupied`** in practice. `cleaning` and `maintenance` are in the type and are written by the (dead) `checkOutGuest`, but there is no UI to set them — and check-out sets `available` directly, skipping the cleaning state entirely. Rooms in those states vanish from the front desk.
8. **`pricePerNight` is written via `as any`** in `RoomsAndQrTab` (default `150`), is absent from the `Room` interface, and is never read. There is no rate anywhere in the system.
9. **No pagination or query limits.** Every `subscribeRooms` / `subscribeOrders` / `subscribeFoodItems` streams the entire collection into memory. `orders` grows forever — the 24h reports tab pulls **all** orders, not the last day.
10. **Timestamps are client-side ISO strings**, not `serverTimestamp()`. Clock skew across devices and mixed local/UTC arithmetic (`new Date(room.checkedInAt).toLocaleDateString()`) will cause ordering and reporting bugs. `superAdminBootstrap` is the one place using `serverTimestamp()`.
11. **No error boundary, no toast system.** 21 `alert()` calls for user-facing errors; `window.confirm` for destructive actions.
12. **No tests, no README, no CI, no ESLint** (`"lint": "tsc --noEmit"` is type-checking, not linting), no `firebase.json`, no `functions/`, no Prettier config.
13. **Bundle: 1.17 MB JS / 296 KB gzip**, single chunk, no `manualChunks` or route-level `import()`.

### 🟡 Cosmetic / template residue

14. `package.json` `"name": "react-example"` — AI Studio template default.
15. AI Studio artifacts still present: `metadata.json`, `firebase-blueprint.json`, `assets/.aistudio/`, `bun.lock` alongside `package-lock.json`.
16. **`firebase-blueprint.json` has already drifted from the code**: it declares `staff` and `bookings` entities that don't exist, uses `rooms.qrCodeToken` (code uses `permanentToken`), and types `floor` as `string` (code uses `number`).
17. Hardcoded hex values (`#e8e4dd`, `#ece6fb`, `#1b1938`, `#292827`, `#73706d`…) are duplicated ~200 times across the hotel-admin tabs, bypassing the design tokens already defined in `index.css`. The `guest`, `super-admin`, `common` and `LoginPage` components use tokens properly; the nine admin tabs do not. Two visual dialects in one app.
18. Default values baked into UI: wizard `timezone: 'America/New_York'`, `secondaryColor: '#292827'`, `fontFamily: 'Inter, sans-serif'`, a fixed welcome message, and Header's `'America/New_York'` clock fallback. Currency symbol falls back to `'$'` in every price render.
19. Unused dependencies: **`@google/genai`, `motion`, `dotenv`** — zero imports across `src/` and `server.ts`. `metadata.json` still declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`, but no Gemini call exists.
20. `/public` contains only the login hero — no favicon, no `manifest.json`, no service worker.
21. `App.tsx` retains the AI Studio `@license SPDX-License-Identifier: Apache-2.0` header; no LICENSE file in the repo.

---

## 8. Environment variables

`.env.example` (the complete file):

```dotenv
GEMINI_API_KEY="MY_GEMINI_API_KEY"   # Required for Gemini AI API calls
APP_URL="MY_APP_URL"                 # Where this applet is hosted
```

**Neither variable is read anywhere in the codebase.** Verified: the only `process.env` reference in the whole repo is `process.env.NODE_ENV` in `server.ts:240`. `dotenv` is installed but never imported. So today the application has **zero runtime configuration** — everything comes from the committed `firebase-applet-config.json`.

Also read indirectly: `DISABLE_HMR` (`vite.config.ts`, to stop file-watching during agent edits).

For a real deployment you'll need to introduce:

| Var | Consumer | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` (apiKey, authDomain, projectId, storageBucket, appId, messagingSenderId) | `src/firebase/config.ts` | Replace the committed JSON import. |
| `VITE_FIRESTORE_DATABASE_ID` | `src/firebase/config.ts` | Currently read from the JSON. |
| `GOOGLE_APPLICATION_CREDENTIALS` (or `FIREBASE_ADMIN_SDK_CONFIG`) | `server.ts` | Admin SDK credentials outside the sandbox. |
| `PORT` | `server.ts` | Currently hardcoded to 3000. |
| `NODE_ENV` | `server.ts` | Already used (Vite middleware vs static). |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | `server.ts` + `superAdminBootstrap.ts` | **Get the email out of source.** |
| `BOOTSTRAP_SUPER_ADMIN_PASSWORD` / one-time setup token | same | **Get the password out of source.** |
| `APP_URL` | QR generation | Currently `window.location.origin` at runtime — acceptable, but breaks for printed QR codes if the domain moves. |

---

## 9. Built vs. scaffolding — the scorecard

### ✅ Genuinely built (reuse or port this)

| Capability | Quality |
|---|---|
| Multi-tenant provisioning + tenant isolation | Good. Solid hotel CRUD, cascade delete across Firestore + Storage + Auth. |
| Firebase Auth with role resolution and tenant scoping | Good, if convoluted (dual claim/doc source, 600 ms retry hack). Fail-closed on missing role — correct. |
| Firestore + Storage security rules | Good baseline for 2 roles. Needs the claim/doc asymmetry fixed and `users` locked down. |
| Real-time order pipeline (guest → Firestore → KDS/housekeeping/live boards) | The strongest feature. `onSnapshot` throughout, genuinely live. |
| New-order alerting (Web Audio siren + speech + toasts, `docChanges` with first-snapshot suppression) | Surprisingly complete. |
| Image upload pipeline (validate → progress → deterministic path → orphan cleanup) | Good. Validation enforced in both client and rules. |
| Room QR generation (permanent tokens, downloadable PNGs) | Good. Tokens are non-guessable-ish (`qr_{hotelId}_rm{n}_{base36}`) but not server-verified. |
| Super-admin hotel admin provisioning via secondary Firebase app | A legitimate, well-documented free-tier pattern. |
| Design system (`index.css` tokens, Superhumon three-canvas language) | Real, deliberate work — but only half the components use it. |
| Express + Admin SDK server with 5 routes | Small but real; builds and runs. |

### 🧱 Scaffolding / demo-grade (rebuild these)

| Area | State |
|---|---|
| Reservations | **Absent.** Check-in mutates the room doc; `bookings` collection is dead code. No availability, no date ranges, no conflict detection, no transactions. |
| Rates & inventory | **Absent.** No rate plans, seasons, packages, or per-date inventory. |
| Folio / billing | **Absent.** No invoice, tax/GST, discount, or payment capture anywhere. `totalAmount` on orders is display-only. |
| Night audit | **Absent.** "24h Daily Reports" computes from live data with no period close. |
| Guest profile / history | **Absent.** Guest identity is three string fields on a room; wiped at check-out. |
| Housekeeping (real) | Request queue only — no room-status board, no cleaning schedule, no task assignment. |
| Staff & RBAC | 2 of 8 declared roles exist. No staff accounts, no assignment, no audit trail. |
| Reporting | Three tabs of client-side `reduce()` over in-memory arrays. No aggregation pipeline, no scheduled exports. |
| Channel manager / OTA | **Absent.** No external distribution whatsoever. |
| Guest-facing auth | **Absent** — the portal is admin-only in practice. |
| Navigation | No router; state-based tab switching. No deep links, no back button. |
| Ops | No tests, CI, README, error boundary, logging, monitoring, or rule-deployment config. |

### Gap analysis vs. MARG / eZee Absolute

| PMS module | Status |
|---|---|
| Room & room-type inventory | 🟡 Rooms yes; room *types* are a free-text string; no type-level inventory. |
| Reservation / booking engine | 🔴 None |
| Availability calendar / Tape chart | 🔴 None |
| Check-in / check-out | 🟡 Present but write-to-room only; no registration card, no ID capture, no room move. |
| Rate management / seasonality | 🔴 None |
| Folio & invoicing (with GST) | 🔴 None |
| Payments & settlements | 🔴 None |
| Night audit | 🔴 None |
| Housekeeping management | 🟡 Request queue only |
| POS / F&B ordering | 🟢 Menu management + ordering + KDS — the one area at demo-plus quality |
| Guest profile / CRM / loyalty | 🔴 None |
| Channel manager (Booking.com, MMT, Airbnb) | 🔴 None |
| Reports & MIS | 🟡 Three summary tabs, client-side only |
| Multi-property / multi-tenant | 🟢 Genuinely built |
| User roles & permissions | 🔴 2 of 8; no granular permissions |

---

## 10. Suggested rebuild order

1. **Stop the bleeding** — remove the hardcoded bootstrap credentials (env vars or a one-time Cloud Function), remove the unauthenticated bootstrap endpoint or gate it behind a setup token, close `users` read access, drop unused deps.
2. **Fix the guest portal** — anonymous auth (or per-room token claims) + rules that grant a guest read on their own room/menu and write on their own orders. Without this the product's headline feature doesn't work.
3. **Introduce a real data model** — `reservations`, `ratePlans`, `inventory/{date}`, `folios`, `guests`, `staff`; normalise `orders.status` to one enum with one transition table; switch timestamps to `serverTimestamp()`.
4. **Build the reservation engine** — availability search, tape chart, conflict-free booking via `runTransaction` + a date-inventory write, then wire check-in/out to it instead of mutating rooms.
5. **Add billing** — folio, tax, payments, invoice; that's the difference between a request app and a PMS.
6. **Then** staff RBAC, housekeeping board, night audit, channel manager, and a real reporting layer (scheduled aggregation docs rather than client-side reduces).
7. **Ops** — router, error boundaries, tests, CI, `firebase.json` for rule deployment, bundle splitting.

---

## 11. Remediation log (security fixes #1–4)

Applied on this branch, ahead of the reservation engine. Every change is
verifiable with `npx tsc --noEmit`, `npm run build`, and the curl checks below.

### Fix 1 — remove the hardcoded super-admin bootstrap

| Change | Detail |
|---|---|
| **Deleted** | `src/services/superAdminBootstrap.ts` (contained `ra7650384@gmail.com` + `9852120609`) |
| **Added** | `scripts/create-super-admin.ts`, wired up as `npm run create-super-admin` |
| **Removed** | `bootstrapSuperAdmin()` from `firestoreService`; bootstrap effect, `BOOTSTRAP_SUPER_ADMIN_EMAIL` import and `bootstrapSettled` state from `AuthContext` |
| **Removed** | hardcoded email + `'admin123'` fallback from `server.ts` |

Nothing was moved into `.env` — the credentials are not in the repo in any
form. The script takes the email (and optionally the password) as CLI
arguments or environment variables at run time, and generates a CSPRNG
password when none is supplied. It creates the Auth user, sets the
`{ role: 'super_admin' }` claim, and writes the `users/{uid}` role document —
i.e. everything the old client bootstrap did, but from an operator's terminal
instead of every visitor's browser. Full walkthrough:
[`docs/super-admin-setup.md`](docs/super-admin-setup.md).

Verified: `grep -rl "ra7650384\|9852120609\|admin123" dist/` returns nothing, so
the credentials are no longer in the shipped bundle.

### Fix 2 — the open bootstrap route is gone

`POST /api/auth/bootstrap-super-admin` was **deleted**, not gated: with the
one-off script there is no legitimate runtime caller left. Verified:

```bash
curl -X POST localhost:3000/api/auth/bootstrap-super-admin \
     -d '{"email":"attacker@evil.com","password":"hunter2"}'   # → 404
```

Also added while touching the server: a small in-memory rate limiter (20
req/min on `/api/guest/session`, 30 req/min on `/api/admin/set-user-claims`),
a 64 KB JSON body cap, and `PORT` is now read from the environment instead of
being hardcoded to 3000.

### Fix 3 — `/users` is no longer world-readable **or self-writable**

```js
// before
allow get, list: if true;
allow create: if isSuperAdmin() || (isAuthenticated() && request.auth.uid == uid && …);

// after
allow get:    if isAuthenticated() && (request.auth.uid == uid || isSuperAdmin());
allow list:   if isSuperAdmin();
allow create, update, delete: if isSuperAdmin();
```

The second half of this fix is the more important one and was **not** in the
original request: the old `create` rule let *any* signed-in user write their
own `users/{uid}` document with an arbitrary `role` — so anyone could persist
`{ role: 'super_admin' }` and, because `isSuperAdmin()` trusts the role
document, gain read/write on every hotel in the platform. Fix 4 would have
made that trivially exploitable by any guest, since it hands out
authentication to anyone who loads the portal. Role documents are now written
only by the Admin SDK (server) or the provisioning script, both of which
bypass rules.

The ruleset was also restructured so every `get()`/`exists()` is guarded: the
old `getUserData().data` threw for any user without a role document (every
anonymous guest), which error-denied the whole ruleset and would have blocked
guest access outright. Guest checks are evaluated first in each `||` chain so
anonymous callers never reach a document read.

### Fix 4 — anonymous guest sessions, scoped to one room

**Flow:** guest scans `/?token=<permanentToken>` → `signInAnonymously()` →
`POST /api/guest/session` → server resolves the token with an Admin SDK
`collectionGroup('rooms')` query → server sets custom claims
`{ role:'guest', hotelId, roomId, roomNumber }` → client refreshes its token →
Firestore rules scope every subsequent read/write.

The token is resolved server-side on purpose: a client cannot query across
hotels, so this is the only way to map token → tenant without exposing a
cross-tenant read. New files: `src/services/guestSession.ts`;
`firestoreService.subscribeRoom()` and `subscribeGuestOrders()`.

Server-side guards on `/api/guest/session`:

- valid Firebase ID token required (401 without one),
- `firebase.sign_in_provider == 'anonymous'` — a real account is refused (403),
- reject if the caller already has any `role` claim, so a staff member can
  never be demoted to guest scope (403),
- unknown token → 404, no information about which hotels exist,
- 20 requests/minute per IP (429).

Rules granted to a guest — and nothing else:

| Path | Guest access |
|---|---|
| `hotels/{hotelId}` | `get` — own hotel only |
| `…/rooms/{roomId}` | `get` — **own room only**; `list` denied (rooms carry other guests' names/phones) |
| `…/foodItems`, `…/services` | `read` — own hotel |
| `…/orders` | `get` own orders (`guestUid == request.auth.uid`); `create` with a whitelisted field set (`hasOnly`), forced `guestUid`, forced `roomId == claim.roomId`, `status` forced to `PENDING`; **no** update/delete (a guest cannot complete or cancel their own order) |
| everything else | denied |

Staff are unaffected: `GuestRoomView` keeps a second path for a signed-in
admin using "Test in Guest Portal", which reads with their existing
`hotel_admin`/`super_admin` privileges.

**Two follow-ups for you:**

1. **Enable Anonymous sign-in** in Firebase console → Authentication →
   Sign-in method → Anonymous. Until then the portal returns
   `guest/anonymous-disabled`.
2. **Room tokens are now unguessable** (`crypto.randomUUID()`) for newly
   created rooms; existing rooms keep their current token so already-printed
   QR codes keep working.

**Known limitation (deliberate, flagged rather than hidden):** Firestore rules
cannot inspect a query's `where()` filter, so a guest's order *list* is scoped
to their hotel by the rule and to their own uid by the client query
(`where('guestUid','==',uid)`). A guest writing their own client could list
other orders within the same hotel. The airtight fix is to give guests a
per-uid mirror path (`hotels/{id}/guestOrders/{uid}/…`) or to serve guest
history through a callable/Cloud Function — worth folding into the
reservation-engine data model rather than bolting on now.

**Still to do (unchanged from §7):** deploy the rules (no `firebase.json`
exists yet — see `docs/super-admin-setup.md`), and delete/rotate the
`ra7650384@gmail.com` account if the old bootstrap ever ran against a live
project.

---

## 12. Reservation engine (implemented)

Built to the agreed schema. Model, invariants, flows and migration steps are in
[`docs/reservation-model.md`](docs/reservation-model.md). Summary:

### What was built

1. **Migration** — `npm run migrate:reservations` (dry-run by default,
   `--apply` to write). Infers `roomTypes` from the legacy free-text `room.type`
   (median `pricePerNight` → `baseRate`, max `capacity` → `maxOccupancy`, else
   one "Standard" type per hotel), stamps `roomTypeId`, normalises status
   casing, converts every occupied room into a `guests` doc + `CHECKED_IN`
   booking + roomNights + OPEN folio, and deletes the guest fields off the room.
2. **`createBooking` in a `runTransaction`** — reads every
   `roomNights/{roomId}_{date}` for `[checkInDate, checkOutDate)`, throws
   `BookingConflictError` (with the conflicting dates) if any exist, otherwise
   writes booking + one roomNight per night + folio atomically. Availability
   search uses a single range query on `date` (ISO dates sort
   lexicographically — no composite index).
3. **Front desk rewired** — `GuestCheckinTab` rewritten around bookings:
   availability-aware New Reservation modal, Due to Arrive / In House /
   Upcoming / Recently Checked Out, check-in → `CHECKED_IN` + room `occupied`,
   check-out → `CHECKED_OUT` + room **`cleaning`**.
4. **Order → folio charge** — `POST /api/guest/orders/:orderId/charge` writes a
   `FOOD`/`SERVICE` charge and increments the balance via the Admin SDK
   (guests have no folio access). Idempotent per `sourceOrderId`, best-effort,
   order pipeline core untouched.
5. **Rules** — `guests`, `roomTypes`, `roomNights`, `bookings`, `folios`
   (+ `charges`, `payments`) are `isStaffOf(hotelId)` only.

Plus, to keep the app coherent: a **room-status board in HousekeepingTab**
(`cleaning`/`maintenance` → `available`) so checked-out rooms don't strand;
`RoomsAndQrTab` now links rooms to room types instead of a per-room price;
`RoomStatus` casing fixed to the four-value union everywhere.

### Flagged: components that assumed room-doc guest fields

| Location | Was | Now |
|---|---|---|
| `GuestCheckinTab` | wrote/read `room.guestName|guestPhone|guestEmail|checkedInAt|expectedCheckout`; occupancy inferred from `room.status` | **rewritten** — joins `bookings` + `guests` + `roomTypes`; creates real bookings |
| `RoomsAndQrTab:214` | rendered `room.guestName` on the room card | removed; shows the room type + a "no room type linked" hint until migration runs |
| `GuestRoomView:195,238,342` | `room?.guestName` for the welcome line and as the name on orders | uses `guestSession.guestName`, resolved **server-side** from the active booking and handed over as a display-only claim (guests still cannot read bookings) |
| `firestoreService.createBooking` | wrote `bookings` + patched room to `occupied` | replaced by the transaction |
| `firestoreService.checkOutGuest` | set room `available` | sets `cleaning` |
| `types.ts Room` | 7 guest/occupancy fields | `roomTypeId` + 4-value `status` only |
| `HotelDashboardTab:47` | `status === 'occupied' \|\| 'OCCUPIED'` | `'occupied'` (dead casing removed) |

**Unaffected** — these read `order.guestName`, not the room:
`NewOrderAlertCenter`, `HotelDashboardTab` (order list), `HousekeepingTab`,
`KitchenDisplayTab`, `LiveRequestsTab`.

### Two requirement conflicts, resolved as flagged

- **Req 4 vs Req 5:** a guest cannot write a charge to a folio they may not
  read. The charge is written by the server (Admin SDK) after the normal order
  write — the order pipeline itself is untouched. Non-atomic: if the client
  dies between the two calls the folio misses that charge. Proper fix is a
  Cloud Function (Blaze) or a night-audit sweep; logged as a known gap.
- **Req 3's `cleaning` dead-end:** nothing cleared `cleaning`, so checked-out
  rooms would have vanished from the front desk (audit §4). Added the minimal
  room-status board in HousekeepingTab.

### Verification

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- `npm run check:dates` — 17/17 pass, including the half-open interval
  (check-out day not charged), month/year boundaries and a leap day.
- Endpoints: `/api/guest/orders/:id/charge` → 401 without a token, 401 with a
  malformed token; `/api/guest/session` → 401 without a token.
- Migration was **not** executed — it needs real Admin credentials. Run the dry
  run first against a copy of production data.
