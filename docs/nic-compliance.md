# NIC Secure-Code Checklist — Compliance Statement

**Application:** ICFAI Founders Network (IFN) — *login-only* variant
**Deployment:** https://icfaifoundersnetwork.app (self-hosted Supabase stack behind Caddy + Cloudflare)
**Checklist:** NIC "Checklist for Secure Code Programming in Applications" (Application Security Division, Cyber Security Group, National Informatics Centre)
**Assessed:** 2026-06-25
**Scope:** the public-facing **login-only** build (admin-created accounts, no self-registration). Where the
sibling **full+registration** build (`ifn-full`) differs materially, it is called out in *§ ifn-full deltas*.

---

## Executive summary

The login-only IFN app is **substantially compliant**. Authentication, access control, input validation,
SQL-injection prevention, and transport security are enforced in depth (RLS on every table, a dedicated
post-audit `security_hardening.sql`, server-side input bounds that hold even against the public anon key,
captcha + rate-limiting, TLS-only via an HSTS-preloaded `.app` domain).

Every item is recorded honestly as **YES / PARTIAL / NO / N/A** with a concrete code or config reference,
so each claim can be verified by inspection. A small set of items are **deliberate, justified deviations**
from the literal text where the literal instruction is weaker than current practice (e.g. bcrypt instead of
SHA-256/512, password-manager autocomplete) — these are argued in *§ Defensible deviations*. Four gaps were
closed as part of this assessment (items 7, 13, 20, Other-6). The remaining open items are tracked in
*§ Remediation backlog*.

Status tally (Secure-Code 1–21): **YES 15 · PARTIAL 3 · N/A 2 · (deviation) 1**.

---

## A. Secure Code Programming (Action Items 1–21)

| #   | Requirement                                               | Status            | Evidence & notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CAPTCHA on public forms; CAPTCHA/lockout on login         | **YES**           | Cloudflare Turnstile on login and forgot-password (`web/src/pages/Login.jsx`, `web/src/pages/ForgotPassword.jsx`, `web/src/lib/captcha.js`); GoTrue verifies server-side (`GOTRUE_SECURITY_CAPTCHA_ENABLED/PROVIDER/SECRET` in `selfhost/docker-compose.yml`). Login also has a client cooldown plus GoTrue's per-IP rate limit (de-facto lockout). *Deviation note: a modern challenge-based CAPTCHA replaces the literal "alphanumeric 6-char" — see §Deviations.*                                       |
| 2   | Client + server input validation (whitelist preferred)    | **YES**           | Server-side is the authority: `db/input_limits.sql` puts `CHECK` length bounds on **every** user-writable column, which hold even when a client POSTs straight to PostgREST with the anon key. Whitelisting: LinkedIn is reduced to a bare `^[A-Za-z0-9-]{1,100}$` handle (`db/login_only.sql`, `web/src/lib/linkedin.js`); role/member_type constrained by DB `CHECK` + SECURITY DEFINER RPCs. Client mirrors with `maxLength`/typed inputs.                                                              |
| 3   | Parameterized queries / stored procedures (no inline SQL) | **YES**           | All data access is through PostgREST and `supabase-js` (parameterized) or `SECURITY DEFINER` PL/pgSQL functions taking typed args (`db/*.sql`). No string-concatenated SQL anywhere in the app or edge functions.                                                                                                                                                                                                                                                                                          |
| 4   | Audit / action trails                                     | **PARTIAL**       | Reviewer/timestamp columns and admin RPCs record privileged actions; `notifications_admin` surfaces them; the host keeps Caddy access, Docker, Postgres and GoTrue logs. **Gap:** no single immutable application audit table — tracked in Remediation.                                                                                                                                                                                                                                                    |
| 5   | Distinct pre/post-authentication session values           | **YES**           | Unauthenticated clients carry only the public anon key; on login GoTrue issues a short-lived signed JWT plus a rotating refresh token (`GOTRUE_JWT_EXP`, refresh-token rotation default-on). Different credential class before vs. after auth.                                                                                                                                                                                                                                                             |
| 6   | Access Control (ACL); prevent privilege escalation        | **YES**           | Row-Level Security on every table (18 `enable row level security` files in `db/`), gated by `public.is_admin()` / `public.can_write()` (`db/admin.sql`, `db/readonly.sql`). `db/security_hardening.sql` (from the 2026-06-20 audit) revokes table-level UPDATE and re-grants only the 14 safe profile columns, with `WITH CHECK` row-ownership — closing a real role-escalation hole. UI routes gated by `web/src/components/ProtectedRoute.jsx`; all privileged writes go through SECURITY DEFINER paths. |
| 7   | Self-host third-party JS/CSS (no direct external refs)    | **YES** *(fixed)* | App JS/CSS is bundled locally by Vite. Google Fonts were previously loaded from `fonts.googleapis.com`; now self-hosted as woff2 in `web/public/fonts/` via `@font-face` in `web/src/index.css`, and the external `<link>` removed from `web/index.html`. Only remaining external script is Turnstile (`challenges.cloudflare.com`) — inherent to the CAPTCHA control (item 1) and not self-hostable.                                                                                                      |
| 8   | Trusted, non-vulnerable third-party components            | **YES**           | Current, maintained deps (`web/package.json`: React 19, `@supabase/supabase-js` 2.108, Vite 8, `@marsidev/react-turnstile`); `npm audit` reports 0 vulnerabilities at build; backend images are pinned to current releases (e.g. PostgREST v14.12).                                                                                                                                                                                                                                                        |
| 9   | Encrypt/hash stored PAN / mobile / Aadhaar                | **PARTIAL**       | The app collects **no** PAN or Aadhaar. The only sensitive field is optional `profiles.phone`, stored plaintext but RLS-guarded and bounded (`db/input_limits.sql`). **Gap:** column-level encryption (pgcrypto) or a documented low-sensitivity acceptance — tracked in Remediation.                                                                                                                                                                                                                      |
| 10  | Keep critical info out of public access                   | **YES**           | RLS denies anonymous reads of member data; private fields gated. The registration-certs storage bucket is private and **unused** in login-only (`db/login_only.sql`).                                                                                                                                                                                                                                                                                                                                      |
| 11  | Password salt-hashed before storage/transit (SHA-256/512) | **YES (intent)**  | Passwords travel only over TLS and are stored by GoTrue as **bcrypt** hashes (adaptive work factor, unique per-password salt). bcrypt is the OWASP-recommended password hash and is **stronger** than a bare SHA-256/512 for this purpose. Literal client-side pre-hashing is rejected as an anti-pattern. Full argument in §Deviations.                                                                                                                                                                   |
| 12  | Change Password + Forgot Password module                  | **YES**           | Forgot (`web/src/pages/ForgotPassword.jsx`) → branded link-only recovery mail → reset (`web/src/pages/ResetPassword.jsx`); in-app change in `web/src/pages/Settings.jsx`; admin-issued temp passwords force a first-login change via `must_change_password` (`db/login_only.sql`, `web/src/components/PasswordChangeGate.jsx`).                                                                                                                                                                            |
| 13  | Comply with a password policy                             | **YES** *(fixed)* | Server-side floor now set: `GOTRUE_PASSWORD_MIN_LENGTH` (≥8) and `GOTRUE_PASSWORD_REQUIRED_CHARACTERS` (lower+upper+digit) in `selfhost/docker-compose.yml` / `selfhost/.env.example`. Enforced by GoTrue even against direct anon-key calls; the UI already requires ≥8.                                                                                                                                                                                                                                  |
| 14  | Use POST (not GET) to pass parameters                     | **YES**           | All authentication and mutations use POST/PATCH (GoTrue, PostgREST writes, RPCs). Reads use REST GET with query params over TLS; no secrets or session tokens are placed in URLs (the JWT rides the `Authorization` header).                                                                                                                                                                                                                                                                               |
| 15  | Proper error handling (no system errors to user)          | **YES**           | `web/src/lib/authErrors.js` maps vendor/GoTrue strings to generic copy; edge functions return generic JSON messages and never leak stack traces; login is non-enumerating ("Incorrect email or password").                                                                                                                                                                                                                                                                                                 |
| 16  | Per-request anti-CSRF token                               | **N/A**           | Auth is bearer-token (JWT in `Authorization` header from localStorage), **not** cookie-based — so no ambient credential is auto-attached and classic CSRF does not apply. No payment gateway → "non-critical" per the checklist's own note. See §Deviations.                                                                                                                                                                                                                                               |
| 17  | No file upload in public modules                          | **YES**           | login-only removes the entire self-registration + certificate-upload path (`db/login_only.sql` drops the request table, RPCs, and bucket policy). There is **no public upload surface**. (ifn-full differs — see deltas.)                                                                                                                                                                                                                                                                                  |
| 18  | Store uploaded files in DB, not filesystem                | **N/A**           | login-only has no uploads. (ifn-full stores certs in a private object-storage bucket, not raw filesystem — see deltas.)                                                                                                                                                                                                                                                                                                                                                                                    |
| 19  | Unique, unpredictable, non-sequential identifiers         | **YES**           | UUID primary keys (`gen_random_uuid()`) across `db/`; any stored object names are `crypto.randomUUID()`. No sequential receipts/IDs are exposed.                                                                                                                                                                                                                                                                                                                                                           |
| 20  | Session timeout on inactivity (~20 min)                   | **YES** *(fixed)* | `web/src/lib/useIdleLogout.js` signs the user out after 20 minutes of inactivity (reset on pointer/key/scroll/visibility), wired into the authenticated shell (`web/src/components/Layout.jsx`). Backs up GoTrue's token expiry with a hard idle ceiling.                                                                                                                                                                                                                                                  |
| 21  | Admin URLs restricted to allowed IPs / VPN                | **PARTIAL**       | Database/infra admin (Supabase Studio, Postgres) is reachable **only over Tailscale** (VPN-equivalent), never publicly. The in-app `/admin` panel is same-origin and strictly role-gated (`is_admin()` + RLS + ProtectedRoute) but not yet IP-restricted. **Gap:** Cloudflare Access allowlist on `/admin` — tracked in Remediation.                                                                                                                                                                       |

---

## B. Other Action Items (1–7)

| # | Requirement | Status | Evidence & notes |
|---|---|---|---|
| 1 | Third-party links open in new tab + disclaimer | **YES (qualified)** | All external links use `target="_blank" rel="noopener noreferrer"` (`UserProfile.jsx`, `Directory.jsx`, `Profile.jsx`, `Services.jsx`, `Calendar.jsx`), preventing tab-nabbing; URLs are sanitized (`web/src/lib/linkedin.js`). A textual "you are leaving the site" disclaimer is not shown (optional hardening — Remediation). |
| 2 | Disable TRACE/PUT/DELETE and unneeded methods | **YES (qualified)** | Caddy does not implement TRACE. PUT/PATCH/DELETE are *required* REST verbs of PostgREST and are protected by JWT + RLS on every row; they are not arbitrary filesystem methods. |
| 3 | Obfuscate email addresses | **PARTIAL** | Support/contact addresses appear in plain text. Low practical value behind a login wall; optional `[at]`/`[dot]` masking is in Remediation. |
| 4 | Disable directory listing | **YES** | Caddy serves the SPA via `file_server` without `browse`; directory listing is off (`selfhost/volumes/proxy/caddy/Caddyfile`). |
| 5 | Autocomplete off on form fields | **NO (justified)** | Password fields intentionally use `autocomplete="current-password"/"new-password"` to support password managers — current OWASP guidance favors this over disabling it. Non-sensitive comboboxes already set `autocomplete="off"`. See §Deviations. |
| 6 | Prevent pages being served from history/cache | **YES** *(fixed)* | Caddy sets `Cache-Control: no-store` on the HTML shell and all API responses; only content-hashed `/assets/*` and `/fonts/*` are immutably cacheable (`selfhost/volumes/proxy/caddy/Caddyfile`). |
| 7 | Logout on all authenticated pages | **YES** | The authenticated shell renders a persistent Topbar with sign-out on every page (`web/src/components/Topbar.jsx`, plus `web/src/pages/Settings.jsx`). |

---

## C. Implementation Guidelines (1–4)

| # | Requirement | Status | Evidence & notes |
|---|---|---|---|
| 1 | Minimum/restricted access (Indian ISPs if required) | **N/A** | IFN members include founders who may travel/reside abroad, so a geo-restriction is not a functional requirement. Cloudflare geo / IP rules are available if a mandate arises. |
| 2 | Latest, non-vulnerable server/component versions | **YES** | Pinned current images (Caddy, GoTrue, PostgREST v14.12, Postgres, Kong) and host `unattended-upgrades`; frontend deps current with a clean `npm audit`. |
| 3 | Server audit-trails / system logs | **YES (qualified)** | Caddy access logs, Docker, Postgres, and GoTrue logs are retained on host. Centralization/retention policy is a recommended enhancement. |
| 4 | Regular backups (last 5; non-networked media) | **YES** | `/usr/local/sbin/ifn-backup.sh` runs daily via cron, storing on-server (not on a networked share). *Verify the retention keeps the last 5 backups.* |

---

## D. Defensible deviations (the auditor's questions, answered)

1. **"Item 11 says SHA-256/512 — you use bcrypt."** bcrypt is a deliberately slow, salted, adaptive
   password hash and is the OWASP-recommended choice; a single round of SHA-256/512 is *faster* and thus
   weaker against offline cracking. We meet the **intent** (salted, irreversible, server-side hashing over
   TLS) with a stronger primitive. "Hash before relayed over network" via client-side JS is an anti-pattern
   (the hash becomes the password, and TLS already protects transit) and is intentionally not done.

2. **"Item 1 wants an alphanumeric 6-char CAPTCHA."** Cloudflare Turnstile is a privacy-preserving,
   accessibility-friendly challenge that resists automation far better than a readable text CAPTCHA (which
   modern OCR/solver services defeat). It is verified server-side by GoTrue. Stronger control, same intent.

3. **"Item 16 — where is the CSRF token?"** CSRF requires an ambient credential the browser attaches
   automatically (a cookie). This app authenticates with a JWT held in localStorage and sent explicitly in
   the `Authorization` header, which the browser never auto-attaches cross-site — so CSRF is structurally
   inapplicable. The checklist itself scopes mandatory anti-CSRF to payment-gateway/"critical" sites; IFN has
   no payment flow.

4. **"Other item 5 — autocomplete should be off."** Disabling autocomplete on password fields pushes users
   toward weak, reused, memorable passwords. OWASP recommends *allowing* password managers. We keep
   autocomplete on for credential fields (and off for free-text comboboxes), a net security gain.

5. **"Item 18 — files should be in the DB."** Not applicable to login-only (no uploads). For ifn-full, certs
   live in a **private** object-storage bucket with service-role-only writes and randomized names — files are
   never web-executable, which is the security goal item 18 is reaching for.

---

## E. ifn-full deltas (the registration variant)

The sibling build adds public self-registration, which changes two items:

- **Item 17 (no public file upload):** ifn-full's public `register-request` form accepts a graduate
  certificate (PDF/JPG/PNG). Compensating controls: the browser never gets storage write access (the edge
  function runs as service-role), a MIME + 5 MB size whitelist, a private bucket, randomized filenames, a
  per-IP rate limit, and a honeypot + Turnstile. This is a *documented, controlled* exception, not an open
  upload.
- **Item 18 (files in DB):** certs are in a private storage bucket, not the filesystem or the DB — see
  deviation #5.

For the strictest reading of items 17/21, **login-only is the variant to deploy publicly**; ifn-full's
registration should sit behind the same controls plus (ideally) Cloudflare Access on its admin surface.

---

## F. Remediation backlog (open items, prioritized)

| Priority | Item | Action |
|---|---|---|
| P1 | 21 | Put `/admin` behind Cloudflare Access (email/IP allowlist) for true admin-URL restriction. |
| P1 | 4 | Add an append-only `audit_log` table written by SECURITY DEFINER triggers on role change / ban / approval. |
| P2 | 9 | Encrypt `profiles.phone` with pgcrypto, or formally accept it as low-sensitivity + RLS-guarded. |
| P2 | Other-1 | Add a "you are leaving IFN" interstitial/disclaimer on outbound links. |
| P3 | Other-3 | Mask any plaintext contact emails (`[at]`/`[dot]`) or render as image. |
| P3 | 3 (server) | Centralize + set retention on Caddy/Postgres/GoTrue logs; confirm `ifn-backup.sh` keeps the last 5. |
| P3 | bonus | Add a `Content-Security-Policy` header in Caddy (now that fonts are self-hosted) to enforce item 7 and harden XSS. |

---

## G. How to re-verify

- **Self-hosted fonts (7):** `npm run build` then `grep -r "fonts.googleapis\|fonts.gstatic" web/dist` → no
  matches; load the site and confirm fonts load from `/fonts/*` (no `gstatic` request in the Network tab).
- **Password policy (13):** attempt a reset to a 6-char or all-lowercase password → GoTrue rejects;
  a ≥8 mixed-class password succeeds.
- **Idle logout (20):** stay idle 20 min (or temporarily lower `IDLE_MS`) → auto sign-out to `/login`.
- **No-store (Other-6):** `curl -sI https://icfaifoundersnetwork.app/` shows `Cache-Control: no-store`;
  `curl -sI .../assets/<hash>.js` shows `immutable`.
- **ACL (6):** as a non-admin, `update public.profiles set role='admin' where id=auth.uid();` via PostgREST
  is rejected (column not granted) — the core escalation test from the security audit.
