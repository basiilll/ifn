---
title: "ICFAI Founders Network: Codebase Documentation"
subtitle: "Login-only build. Architecture, modules, data model, and key flows."
author: "IFN Engineering"
date: "2026-06-25"
toc: true
toc-depth: 2
numbersections: true
geometry: margin=1in
fontsize: 11pt
colorlinks: true
linkcolor: RoyalBlue
urlcolor: RoyalBlue
---

\newpage

# Overview

The ICFAI Founders Network (IFN) is a private members' web application: a community feed,
member directory, an idea pipeline with mentor review, a problem hub, a services board, an
autopsy library, a calendar, polls, notifications, and an admin panel. This document explains
how the codebase is organized so the application can be understood, run, and extended.

The stack:

- **Frontend:** a React 19 single-page app built with Vite 8, styled with Tailwind CSS,
  routed with React Router 7. No server-side rendering. The build output is static.
- **Backend:** a self-hosted Supabase stack (Docker Compose): Postgres, GoTrue (auth),
  PostgREST (auto REST API), Storage, an edge-function runtime, and a Kong gateway.
  Authorization is enforced in the database with Row-Level Security (RLS).
- **Edge:** Caddy serves the built frontend and reverse-proxies the Supabase API paths to
  Kong. In production it sits behind Cloudflare.

The application uses **no realtime/websockets**; all data access is plain REST through
`supabase-js`. This is the **login-only** build: accounts are created by an admin, there is no
public sign-up, and there is no public file-upload surface.

Source repository: <https://github.com/basiilll/ifn>.

# Repository layout

```
ifn/
  web/                     React SPA (the frontend)
    index.html             Vite entry; references /src/main.jsx and the favicon
    package.json           scripts (dev, build, lint) + dependencies
    vite.config.js         Vite + React + SVGR config
    tailwind.config.js     design tokens (fonts, color CSS variables, dark mode = class)
    public/                static assets served as-is (favicon, fonts/, email/)
    src/
      main.jsx             app entry: mounts <App/> inside <AuthProvider> + <BrowserRouter>
      App.jsx              route table + route guards
      index.css            Tailwind layers, CSS color tokens, @font-face (self-hosted fonts)
      assets/              imported images (logos)
      pages/               one component per route (see Pages)
      components/          shared UI: layout, guards, modals, cards, form inputs, badges
      lib/                 non-UI logic: supabase client, auth context, helpers
  selfhost/                the Supabase Docker stack
    docker-compose.yml         base stack (db, auth, rest, storage, functions, kong, studio)
    docker-compose.caddy.yml   production overlay (Caddy, loopback binds, no public Kong)
    apply-schema.sh            loads db/*.sql into a blank database, in dependency order
    .env.example               every backend env var, documented
    utils/generate-keys.sh     rotates JWT/anon/service-role/db secrets
    volumes/
      functions/             edge functions (bind-mounted; no deploy step)
      proxy/caddy/Caddyfile  Caddy config (TLS, headers, caching, API proxy)
      auth/templates/        branded GoTrue email templates (served by an nginx sidecar)
      db/                    Supabase init SQL (roles, jwt, pooler) - NOT the app schema
  db/                      the application schema (one .sql file per domain)
  docs/                    documentation (this file, the technical manual, NIC compliance)
```

# Frontend

## Build and tooling

`web/package.json` scripts:

| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite` | local dev server against the cloud/dev backend (`.env.local`) |
| `dev:local` | `vite --mode selfhost` | local dev against a local self-hosted stack (`.env.selfhost`) |
| `build` | `vite build` | production build to `web/dist` (static) |
| `lint` | `eslint .` | lint |
| `preview` | `vite preview` | serve the built `dist` locally |

Key runtime dependencies: `react` 19, `react-dom` 19, `react-router-dom` 7,
`@supabase/supabase-js` 2, `@marsidev/react-turnstile` (captcha widget), `lucide-react`
(icons), `react-datepicker` (calendar input). Tailwind 3, Vite 8, and ESLint are dev-only.

**Environment variables (build-time, public, baked into the bundle):**

| Var | Meaning |
|---|---|
| `VITE_SUPABASE_URL` | backend origin; `supabase-js` appends `/auth/v1`, `/rest/v1`, etc. |
| `VITE_SUPABASE_ANON_KEY` | public anon JWT (RLS guards every row) |
| `VITE_TURNSTILE_SITEKEY` | Cloudflare Turnstile public sitekey (unset disables the widget) |

Because these are compiled in, a change requires a rebuild. Files: `web/.env.local` (dev),
`web/.env.selfhost` (local stack), `web/.env.production` (production build).

## Entry and providers

`web/src/main.jsx` applies the saved theme before first paint (adds the `dark` class from
`localStorage`), then mounts:

```
<StrictMode>
  <BrowserRouter>
    <AuthProvider>
      <App />
```

`AuthProvider` (`web/src/lib/AuthProvider.jsx`) is the single source of session and profile
state for the whole app (see Auth and session model).

## Routing and route guards

`web/src/App.jsx` declares every route. Public routes are wrapped in `PublicOnlyRoute`
(redirects an already-authenticated user away from login). The authenticated area is wrapped
in a **chain of guards**, in this order:

```
ProtectedRoute  ->  PasswordChangeGate  ->  OnboardingGate  ->  Layout  ->  <page>
```

| Guard (`web/src/components/`) | Responsibility |
|---|---|
| `PublicOnlyRoute.jsx` | login / forgot-password: bounce signed-in users to the app |
| `ProtectedRoute.jsx` | require a session (else `/login`, carrying the attempted location); show a branded loader while the session resolves; block banned accounts |
| `PasswordChangeGate.jsx` | if `profile.must_change_password`, force a new password (calls `supabase.auth.updateUser` then the `set_password_changed` RPC) before anything else renders |
| `OnboardingGate.jsx` | if the profile row is missing or `onboarded` is false, redirect to `/onboarding` |
| `Layout.jsx` | the authenticated shell: Topbar, SideNav, page `<Outlet/>`, and `useIdleLogout()` |

Route table:

| Path | Component | Notes |
|---|---|---|
| `/login` | `Login` | public; captcha + cooldown |
| `/forgot-password` | `ForgotPassword` | public; captcha |
| `/reset-password` | `ResetPassword` | reached from the recovery email link |
| `/onboarding` | `Onboarding` | first-run profile completion |
| `/` (index) | `Feed` | community posts |
| `/post/:id` | `PostDetail` | single post + comments |
| `/profile` | `Profile` | the signed-in user's profile |
| `/u/:id` | `UserProfile` | another member's profile |
| `/settings` | `Settings` | account + password + preferences |
| `/pipeline`, `/pipeline/:id` | `Pipeline`, `PipelineIdea` | idea pipeline (G1 to G6 gates) |
| `/mentor` | `MentorReview` | mentor-only review queue |
| `/services` (`/team` redirects here) | `Services` | offer/request skills and resources |
| `/problem-hub`, `/problem-hub/:id` | `ProblemHub`, `ProblemDetail` | post problems, propose solutions |
| `/calendar` | `Calendar` | events and deadlines |
| `/directory` | `Directory` | browse members |
| `/autopsy-library` | `AutopsyLibrary` | post-mortems of failed ideas |
| `/notifications` | `Notifications` | in-app notifications |
| `/admin` | `AdminPanel` | admin-only |
| `*` | redirect to `/` | catch-all |

## Auth and session model

`web/src/lib/supabase.js` creates one shared `supabase` client from the two VITE env vars
(it throws on startup if they are missing).

`AuthProvider` subscribes to `supabase.auth.onAuthStateChange`, which is treated as the single
source of truth. It emits an `INITIAL_SESSION` event after the client has restored the session
from `localStorage`, then again on sign-in, sign-out, token refresh, and email confirmation.
`loading` is cleared on the first event (not via a separate `getSession`) to avoid a race that
otherwise bounced deep-link hard-refreshes to `/login`.

On each `uid` change it loads the caller's own `profiles` row with `maybeSingle()` (so a user
with no row returns `null`, not a 406 that would spin a gate forever). The context exposes:

| Field | Source | Used for |
|---|---|---|
| `session` | auth event | is the user signed in |
| `loading` | auth settle | show loader vs decide |
| `profile`, `profileLoaded` | own `profiles` row | gate decisions; "fetching" vs "no row" |
| `isAdmin` | `profile.role === 'admin'` | show admin UI |
| `isMentor` | role admin or mentor | show mentor UI |
| `banned`, `restricted`, `onboarded` | profile flags | block / soft-block / route |
| `refreshProfile()` | re-fetch | after a profile-changing action |

These flags drive **display and routing only**. Every privileged action is re-checked
server-side: admin RPCs call `is_admin()` inside the database, and RLS guards every read and
write regardless of what the client believes.

## Pages

One component per route in `web/src/pages/`. Each fetches its own data through `supabase-js`
and renders a skeleton while loading.

| Page | What it does |
|---|---|
| `Login` | email/password sign-in with Turnstile + a client cooldown after a 429 |
| `ForgotPassword` | request a reset link (Turnstile-gated); generic success (no enumeration) |
| `ResetPassword` | set a new password from the recovery link |
| `Onboarding` | complete the profile on first login |
| `Feed` | community posts; create posts/polls via modals |
| `PostDetail` | a single post with comments and sub-threads |
| `Profile` / `UserProfile` | own / others' profile; LinkedIn rendered from a stored handle |
| `Settings` | change password, notification preferences, visibility, account fields |
| `Pipeline` / `PipelineIdea` | submit and track a startup idea through gates G1 to G6 |
| `MentorReview` | mentors review submissions and manage assigned ideas |
| `Services` | offer or request skills/resources (the former "team" board) |
| `ProblemHub` / `ProblemDetail` | post problems; the network proposes and upvotes solutions |
| `AutopsyLibrary` | searchable post-mortems of failed ideas |
| `Calendar` | events and deadlines, with add-to-calendar export |
| `Directory` | browse/search members; Contact button relays a message via `send-contact` (no address exposed) |
| `Notifications` | in-app notification feed |
| `AdminPanel` | members, roles, moderation, pipeline oversight, settings |

## Components

Grouped by role (`web/src/components/`):

- **Shell and navigation:** `Layout`, `Topbar`, `SideNav`, `RightSidebar`.
- **Route guards:** `ProtectedRoute`, `PublicOnlyRoute`, `OnboardingGate`, `PasswordChangeGate`.
- **Modals:** `ModalShell` (base), `ConfirmModal`, `CreatePostModal`, `CreatePollModal`,
  `ProblemModal`.
- **Content:** `PostCard`, `PollBlock`, `AuthorLink`.
- **Loading skeletons:** `PostCardSkeleton`, `PostDetailSkeleton`, `ProfileSkeleton`,
  `PipelineSkeleton`.
- **Form inputs:** `Combobox`, `MultiSelect`, `Dropdown`, `PasswordInput`.
- **Badges and chips:** `RoleBadge`, `MemberTypeBadge`, `MemberTypeChips`.
- **Branding and misc:** `Logo` (light + dark variants), `Spinner`, `FirstRunBanner`.

## lib modules

Non-UI logic in `web/src/lib/`:

| Module | Role |
|---|---|
| `supabase.js` | the shared `supabase-js` client (one instance) |
| `AuthProvider.jsx` | session + profile React context (see above) |
| `captcha.js` | Turnstile sitekey + a kill switch on its presence |
| `authErrors.js` | maps GoTrue error strings to in-house copy (never render a vendor string) |
| `errors.js` | maps a generic Supabase/Postgres error to a user message |
| `useIdleLogout.js` | signs out after 20 minutes of inactivity (NIC item 20) |
| `usePageTitle.js` | sets `document.title` per page |
| `linkedin.js` | store LinkedIn as a bare handle; render a safe `linkedin.com/in/<handle>` URL |
| `format.js` | compact relative time ("3h", "2d") |
| `calendar.js` | per-event add-to-calendar export (no OAuth) |
| `options.js` | profile option lists (sectors, domains, member types) |
| `pipeline.js` | pipeline gate constants (G1 to G6), shared by pipeline/mentor/admin |

## Styling and theming

Tailwind CSS, configured in `web/tailwind.config.js`. Dark mode is class-based
(`darkMode: 'class'`); `main.jsx` sets the `dark` class from `localStorage` before paint.
Neutral colors are CSS custom properties (RGB channels) declared in `web/src/index.css`, so
both light and dark themes resolve through the same Tailwind tokens. Fonts (Bricolage
Grotesque, Instrument Sans) are self-hosted as woff2 via `@font-face` in `index.css` (no
third-party font CDN).

\newpage

# Backend and data model

## Supabase services

The frontend never talks to Postgres directly. It calls `supabase-js`, which hits these
paths, all proxied by Caddy to the Kong gateway:

| Path prefix | Service | Used for |
|---|---|---|
| `/auth/v1/*` | GoTrue | sign-in, sign-out, password reset, the admin user API |
| `/rest/v1/*` | PostgREST | table reads/writes and RPC calls, all under RLS |
| `/storage/v1/*` | Storage | object storage (private buckets) |
| `/functions/v1/*` | edge-runtime | the custom edge functions |

## Schema overview

The application schema lives in `db/`, one file per domain. It is loaded by
`selfhost/apply-schema.sh` in dependency order. There are roughly **30 tables, 118
functions, and 65 RLS policies**.

> Operational note: on a blank database, run `apply-schema.sh` twice. It is idempotent and
> converges on the second pass (`readonly.sql` defines `can_write()` but references columns and
> tables created in later files, so the first pass leaves it uncreated; the second pass has
> everything).

Tables by domain:

| Domain | File(s) | Tables |
|---|---|---|
| Identity | `profiles.sql`, `admin.sql` | `profiles`, `app_settings`, `banned_emails` |
| Feed and posts | `posts.sql`, `votes.sql`, `comments.sql`, `tags.sql`, `polls.sql` | `posts`, `post_votes`, `comments`, `sub_threads`, `tags`, `post_tags`, `tag_requests`, `poll_options`, `poll_votes` |
| Pipeline | `pipeline.sql` | `pipeline_ideas`, `idea_submissions`, `idea_reviews`, `idea_actions`, `idea_messages`, `gate_transitions`, `attachments` |
| Problem hub | `problemhub.sql`, `problem_upvotes.sql`, `problem_votes_v2.sql` | `problems`, `problem_solutions`, `problem_upvotes`, `problem_votes` |
| Services / team | `teamboard.sql` | `team_posts`, `team_applications` |
| Directory | `directory.sql` | `contact_log` |
| Autopsy | `autopsies.sql` | `idea_autopsies` |
| Calendar | `calendar.sql` | `events` |
| Notifications | `notifications.sql` | `notifications` |
| Invites | `invites.sql` | `invites` |

`registration_requests.sql` exists in the tree but its table and policy are dropped at the end
of `login_only.sql`, because this build has no public registration.

## Security model

Authorization is enforced in Postgres, not only in the UI.

- **Row-Level Security on every table.** Reads and writes are constrained by policies. The
  central helpers are `public.is_admin()` and `public.can_write()` (the latter returns false
  for banned or read-only-restricted users).
- **Privileged writes go through `SECURITY DEFINER` functions (RPCs).** Setting a role, banning
  a user, approving a submission, and similar actions are RPCs that re-check `is_admin()`
  server-side and bypass column grants safely. Direct client UPDATEs are limited to a small set
  of own-profile columns.
- **`db/security_hardening.sql`** (from the 2026-06-20 audit) revokes table-level UPDATE on
  `profiles` and re-grants only the safe, user-editable columns with a `WITH CHECK`
  row-ownership clause, closing a real privilege-escalation hole.
- **`db/input_limits.sql`** adds `CHECK` length bounds on every user-writable text column. This
  holds even when a client posts directly to PostgREST with the anon key.
- **`db/readonly.sql`** implements a soft-block tier (`restricted`): a restricted member can
  browse but every write path is denied.

## The login-only fork

`db/login_only.sql` runs last and does three things: it drops the self-registration queue and
its certificate bucket policy; it adds the `must_change_password` column used for
admin-created accounts; and it normalizes any stored LinkedIn values to bare handles (an
anti-XSS measure for the directory).

\newpage

# Edge functions

Edge functions are in `selfhost/volumes/functions/`. They are **bind-mounted** into the
edge-runtime container, so there is no deploy step: editing a file and recreating the
container is enough.

| Function | Purpose |
|---|---|
| `main` | the edge-runtime gateway/entry that routes to the individual functions |
| `create-member` | an admin creates an account directly and the member is emailed sign-in details |
| `send-contact` | relays a member-to-member message from the Directory without exposing any address |
| `_shared` | shared helpers (password generation) |

There are two privileged functions in this build. `create-member`'s flow:

1. Require an `Authorization` header; reject otherwise.
2. Authorize the caller: read their own `profiles.role` with their JWT and require `admin`.
3. Create the account with the service role via GoTrue's admin API (`email_confirm` true).
4. Set the role and member type on the profile row created by the new-user trigger.
5. Generate and return a temporary password (shown once in the admin UI), and email it.

It is deliberately **egress-free**: it calls the internal Kong gateway (`http://kong:8000`)
with plain `fetch` rather than importing a runtime module from the internet, which previously
hung the function.

`send-contact` backs the Directory's **Contact** button, so members can message each other
without any email address reaching the browser. Its flow:

1. Require an `Authorization` header; reject otherwise.
2. Authorize the caller and run the `contact_member` RPC as them: it enforces not-banned,
   recipient-reachable, not-self, and a **10-per-24h** cap (serialized with an advisory lock so
   concurrent requests cannot exceed it), and writes an audit row to `contact_log`.
3. Resolve the recipient's real email with the service role (never returned to the client).
4. Send the message through **Resend's HTTP API** (`SMTP_PASS` is the Resend API key, the same
   credential the GoTrue mailer uses), with the sender as `reply_to` so the recipient can reply
   directly.

Like `create-member` it imports no runtime module for sending (a boot-time SMTP-library import
hung the edge runtime); it calls Resend with plain `fetch`. Both auth mail and this relay draw
on the same Resend quota (see [email-smtp.md](email-smtp.md)).

# Key flows

**Sign-in.** `Login` collects email/password and a Turnstile token, calls
`supabase.auth.signInWithPassword`. GoTrue verifies the captcha and credentials and returns a
JWT. `onAuthStateChange` fires; `AuthProvider` stores the session and loads the profile;
the guard chain renders the app.

**First login (admin-created account).** The admin issues a temporary password.
`PasswordChangeGate` sees `must_change_password`, forces a new password
(`auth.updateUser` then the `set_password_changed` RPC), `refreshProfile()` clears the flag,
then `OnboardingGate` sends the user to `/onboarding` to complete their profile.

**A normal data write.** The page calls `supabase.from('table').insert/update(...)` or an
RPC. PostgREST applies the table's RLS policies; privileged changes are rejected unless made
through the appropriate `SECURITY DEFINER` RPC.

**Admin adds a member.** `AdminPanel` calls the `create-member` edge function, which performs
the admin check and the service-role account creation server-side, then returns the temporary
password for the admin to share.

# Conventions

- **Authorization is server-side first.** UI flags (`isAdmin`, `restricted`) are for display
  and routing; the database re-checks every privileged action.
- **Privileged writes are RPCs**, not direct table writes. Direct client writes are limited to
  own-profile safe columns.
- **No vendor error strings in the UI.** `lib/authErrors.js` and `lib/errors.js` map backend
  errors to in-house copy; unknown errors fall back to a generic line.
- **Loading uses skeletons**, not blank screens or bare spinners, on content pages.
- **Inputs are bounded server-side** (`input_limits.sql`); client `maxLength` is cosmetic.
- **External links** use `target="_blank" rel="noopener noreferrer"`, and user-supplied URLs
  (LinkedIn) are sanitized to a safe shape.
- **Frontend env is build-time**; rebuild after changing it.

# Local development

1. Install dependencies: `cd web && npm install`.
2. Choose a backend:
   - Cloud/dev: set `web/.env.local`, run `npm run dev`.
   - Local self-hosted stack: bring up `selfhost` (Docker), set `web/.env.selfhost`, run
     `npm run dev:local`.
3. For a local stack: `cd selfhost`, `cp .env.example .env`, rotate secrets with
   `./utils/generate-keys.sh --update-env`, `docker compose up -d`, then
   `./apply-schema.sh` (twice on a fresh database). Create the first admin in Supabase Studio
   and set `role='admin'` on its profile row.
4. Production build: `cd web && npm run build` produces `web/dist`, which Caddy serves.

The deployment, networking, and operations details are in `docs/IFN-Technical-Manual.md`.
The security-control mapping is in `docs/nic-compliance.md`.

# Appendix: where to change things

| To change ... | Look in |
|---|---|
| A page's behavior | `web/src/pages/<Page>.jsx` |
| Shared UI (cards, modals, inputs) | `web/src/components/` |
| Auth/session logic | `web/src/lib/AuthProvider.jsx`, `web/src/components/*Gate.jsx`, `ProtectedRoute.jsx` |
| Routing | `web/src/App.jsx` |
| Backend client | `web/src/lib/supabase.js` |
| A table, policy, or RPC | the matching `db/<domain>.sql`, then re-run `apply-schema.sh` |
| Account creation | `selfhost/volumes/functions/create-member/index.ts` |
| Email templates | `selfhost/volumes/auth/templates/` |
| Reverse proxy, TLS, headers, caching | `selfhost/volumes/proxy/caddy/Caddyfile` |
| Backend configuration | `selfhost/.env` (from `.env.example`) |
| Theme tokens / fonts | `web/tailwind.config.js`, `web/src/index.css` |

*End of document.*
