-- ============================================================================
-- NEXORA HOTEL OS — desktop (offline) edition licence registry
-- ============================================================================
-- The Super Admin uses this table to issue Marg-style desktop activations.
-- Each row stores:
--   • the human-readable serial (code),
--   • the signed activation payload (.nexora) that the desktop app verifies,
--   • the customer's username + password SCRYPT hash (the offline app verifies
--     the password against the hash in the signed payload — so the hash is
--     distributed, the plaintext is NOT),
--   • an encrypted copy of the plaintext so the seller can re-share credentials
--     (AES-256-GCM with LICENSE_PASSWORD_KEY from the server .env).
--
-- Licensing is intentionally OFFLINE: the desktop app verifies the signature
-- locally, so revoking a row here stops *new* issues, not already-activated
-- copies (same trust model as Marg-style licensing).
-- ============================================================================

create table public.desktop_licenses (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  hotel_name       text not null,
  owner_name       text not null default '',
  username         text not null,
  email            text,
  password_hash    text not null,
  password_enc     text,                 -- AES-GCM iv:tag:data (LICENSE_PASSWORD_KEY)
  password_plain   text,                 -- fallback when no key configured (warned in logs)
  activation_json  text not null,        -- the .nexora file content (payload + signature)
  activation_string text not null,       -- one-line base64url the customer pastes
  status           text not null default 'issued'
                   check (status in ('issued','activated','expired','revoked')),
  issued_at        timestamptz not null default now(),
  activated_at     timestamptz,
  expires_at       timestamptz,
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index desktop_licenses_status_idx on public.desktop_licenses(status);
create index desktop_licenses_created_idx on public.desktop_licenses(created_at desc);

-- Only Super Admins may see/issue desktop licences (mirrors profiles role).
create policy "desktop_licenses: super admin all" on public.desktop_licenses
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
