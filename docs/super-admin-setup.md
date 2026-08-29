# Provisioning the super admin (and removing the old bootstrap)

## What changed

The app used to create its first super admin from **client-side code** that had
a real email and password committed to the repository:

```ts
// src/services/superAdminBootstrap.ts  ← DELETED
export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'ra7650384@gmail.com';
const BOOTSTRAP_SUPER_ADMIN_PASSWORD = '9852120609';
```

That file shipped in the JavaScript bundle, ran before the login screen on
every page load, and was paired with an **unauthenticated** server route
(`POST /api/auth/bootstrap-super-admin`) that would set or reset that
account's password and attach `role: 'super_admin'`.

Both are gone:

| Removed | Replacement |
|---|---|
| `src/services/superAdminBootstrap.ts` | `scripts/create-super-admin.ts` (run by hand) |
| `POST /api/auth/bootstrap-super-admin` | nothing — delete the route; the script covers it |
| `firestoreService.bootstrapSuperAdmin()` | nothing |
| Hardcoded `BOOTSTRAP_SUPER_ADMIN_EMAIL` / `'admin123'` in `server.ts` | nothing |

## Create the one real super admin

**Prerequisites**

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/to/service-account.json
# or:  gcloud auth application-default login
```

The service account needs *Firebase Authentication Admin* and *Cloud Datastore
User* (the "Firebase Admin SDK Administrator Service Agent" role covers both).

**Create a brand-new account (recommended — the script generates the password)**

```bash
npm run create-super-admin -- --email you@example.com
```

It prints the generated password **once**. Put it in your password manager
immediately; there is no other reset path except re-running the script.

**Use your own password**

```bash
npm run create-super-admin -- --email you@example.com --password 'your-long-password'
```

**Promote an existing Firebase Auth user without changing their password**

```bash
npm run create-super-admin -- --email you@example.com --no-password-change
```

The script is idempotent and does three things:

1. Creates the Auth user if missing (otherwise reuses it).
2. Sets the password (only when one is supplied or generated).
3. Attaches the custom claim `{ role: 'super_admin' }` **and** writes the
   matching `users/{uid}` role document that `firestore.rules` reads.

Then sign in at the app's login screen.

## ⚠️ If the old bootstrap account already exists

`ra7650384@gmail.com` may already be a super admin in your live project. The
code deletion does **not** remove that Auth user. Do this now:

```bash
# 1. Create your new account
npm run create-super-admin -- --email you@example.com

# 2. Sign in as the NEW account and delete the old one from
#    Super Admin HQ → hotel admin actions, or directly:
npm run create-super-admin -- --email ra7650384@gmail.com --no-password-change   # only if you must keep it
#    otherwise disable/delete it in Firebase console → Authentication

# 3. Treat the leaked password as compromised: rotate anything else that
#    reused it. It was public in the JS bundle and in git history.
```

Scrubbing git history (`git filter-repo`) is advisable but will not invalidate
credentials that were already read — **deleting the Auth user is the part that
matters**.

## Deploying the rules

`firestore.rules` and `storage.rules` are not enforced until deployed, and the
repo has no `firebase.json` yet. Add one:

```json
{
  "firestore": { "rules": "firestore.rules", "database": "ai-studio-nexorahotelos-ec6f5ef3-5a4a-489f-a056-b629c08ddcc5" },
  "storage": { "rules": "storage.rules" }
}
```

```bash
firebase use <your-project-id>
firebase deploy --only firestore:rules,storage:rules
```

## One-time console step: enable Anonymous sign-in

The guest portal signs visitors in anonymously (Firebase console →
**Authentication → Sign-in method → Anonymous → Enable**). Until that is on,
`/api/guest/session` returns `guest/anonymous-disabled` and guests see "This
room link can't be opened".
