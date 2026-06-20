# IFN — Rebuild Everything Locally (low-abstraction guide)

Follow this to rebuild the **entire IFN backend + database from scratch** on a **Windows laptop**,
all local: local Postgres, local auth (GoTrue), local storage, local API gateway, local mail
catcher, local edge functions, and the frontend pointed at all of it. No Supabase Cloud, no Vercel,
no cloud database. The only thing that stays external is real email *delivery* (Resend) — and even
that is caught locally while you learn (Mailpit).

This is deliberately **manual** — every command is shown and explained, nothing hidden behind a
script. Once you understand it, `selfhost/apply-schema.sh` does the DB part in one shot.

> **Your laptop, no dual boot.** Windows 10/11 + **Docker Desktop** runs all of this natively
> (Docker Desktop sets up WSL2 for you). You do NOT need Windows Server, a VM, or a Linux dual-boot.
> Run the commands below in a **WSL/Ubuntu** or **Git Bash** shell (so the `< file.sql` redirect
> works); the PowerShell equivalent is noted where it differs.

---

## 0. Prerequisites (install once)

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/ . Install, launch, let it
   enable WSL2 when it asks. Confirm:
   ```bash
   docker --version
   docker compose version
   ```
2. **Git** + the IFN repo checked out on the laptop. All paths below are relative to the repo root
   (the folder containing `db/`, `web/`, `supabase/`, `selfhost/`).
3. **Node.js 20+** (for the frontend, step 7). https://nodejs.org

---

## 1. Get the self-host stack files

The official Supabase self-host stack is a set of Docker containers (Postgres, GoTrue, PostgREST,
Storage, Kong gateway, edge-runtime, Studio, pooler). The repo already carries a configured copy in
`selfhost/`. If you ever need a fresh copy:

```bash
# only if selfhost/ is missing — otherwise skip
git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase /tmp/sb
cd /tmp/sb && git sparse-checkout set docker
cp -rf /tmp/sb/docker/. <repo>/selfhost/
cd <repo>/selfhost && cp .env.example .env
```

What each container is:
- **db** — Postgres 17. Your database.
- **auth** — GoTrue. Signup/login/password-reset, owns the `auth` schema.
- **rest** — PostgREST. Turns tables/RPCs into the REST API the SPA calls.
- **storage** — file storage (the cert + idea-file buckets).
- **kong** — API gateway on port **8000**. Everything the frontend hits goes through here and is
  routed to auth/rest/storage/functions.
- **functions** — edge-runtime. Runs your 5 Deno functions.
- **mailpit** — local mail catcher (added in `selfhost/docker-compose.override.yml`).
- **studio** — the Supabase dashboard UI (browse tables, run SQL).

---

## 2. Configure `selfhost/.env`

Open `selfhost/.env`. The knobs that matter:

```ini
# Loads the base compose + our mailpit override together (so `docker compose` sees mailpit).
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml

# Secrets. The shipped values are PUBLIC DEMO keys — fine for local, NEVER for prod.
# Before any non-local use, regenerate: a 40+ char JWT_SECRET, then derive ANON_KEY and
# SERVICE_ROLE_KEY from it (Supabase self-host JWT generator), plus a real POSTGRES_PASSWORD.
POSTGRES_PASSWORD=...        # any local value
JWT_SECRET=...               # demo OK locally
ANON_KEY=...                 # demo OK locally (must match JWT_SECRET)
SERVICE_ROLE_KEY=...         # demo OK locally (must match JWT_SECRET)

# URLs — local, no domain.
SITE_URL=http://localhost:5173        # the frontend dev origin
API_EXTERNAL_URL=http://localhost:8000
SUPABASE_PUBLIC_URL=http://localhost:8000

# Local mail → Mailpit (catches everything, sends nothing out).
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=no-reply@ifn.local
SMTP_SENDER_NAME=ICFAI Founders Network (staging)
ENABLE_EMAIL_AUTOCONFIRM=false        # so confirm emails actually get sent (into Mailpit)
```

**Port note:** the stack publishes Postgres (via the pooler) on the host. The repo copy remaps it to
**5433** (`docker-compose.yml`, supavisor `ports:` → `5433:5432`) so it doesn't clash if you already
run Postgres on 5432. Leave it unless you have a reason.

---

## 3. Boot the stack (empty)

```bash
cd selfhost
docker compose up -d          # first run pulls several GB — give it a few minutes
docker compose ps             # wait until every service shows "healthy"
```

Sanity checks:
```bash
# GoTrue alive (401 without the key is expected; 200 with it)
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2)
curl -s -o /dev/null -w "auth: %{http_code}\n" -H "apikey: $ANON" http://localhost:8000/auth/v1/health
curl -s -o /dev/null -w "rest: %{http_code}\n" -H "apikey: $ANON" http://localhost:8000/rest/v1/
```
Open **http://localhost:8000** for Studio (login `supabase` / the `DASHBOARD_PASSWORD` from `.env`)
and **http://localhost:8025** for Mailpit.

At this point the database is **blank** — GoTrue/Storage created their own `auth`/`storage` schemas,
but `public` (your app) has zero tables.

---

## 4. Rebuild the database — manual, file by file

Your schema is version-controlled as `db/*.sql`. You apply them **in dependency order** into the
running Postgres. Each file is idempotent (safe to re-run). The command pattern (run from repo root):

```bash
# bash / WSL / Git Bash:
docker compose -f selfhost/docker-compose.yml exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f - < db/<file>.sql

# PowerShell equivalent (no `<` redirect in PowerShell):
Get-Content db\<file>.sql | docker compose -f selfhost\docker-compose.yml exec -T db `
  psql -U postgres -d postgres -v ON_ERROR_STOP=0
```

**Apply in EXACTLY this order.** The order is not alphabetical — it follows the dependency graph:

```
profiles            # base identity table + handle_new_user signup trigger. MUST be first;
                    # almost everything references public.profiles.
readonly            # adds can_write() + the `restricted` column. Must come BEFORE comments/
                    # admin/teamboard/problemhub, which call can_write / read `restricted`.
posts
votes
tags
comments            # needs can_write()  -> readonly already ran
feed
admin               # adds `banned`, is_admin(), admin RPCs; reads `restricted` -> readonly ran
teamboard           # needs can_write()
calendar
directory           # defines directory() / public_profile()
onboarding
notifications
pipeline            # defines pipeline_ideas (the standalone idea pipeline)
notifications_admin # needs pipeline_ideas -> pipeline already ran
polls
problemhub          # needs can_write()
problem_upvotes
problem_votes_v2
invites
registration_requests   # ADDS profiles.member_type column
member_type             # re-shapes directory()/public_profile()/admin_get_profile to include
                        # member_type -> needs the column from registration_requests, runs LAST
```

Why these three orderings matter (the only non-obvious bits):
- **readonly before comments/admin/teamboard/problemhub** — `readonly.sql` introduces `can_write()`
  and the `restricted` column that those files use. (It was added to the codebase later, which is
  why it's not in original alphabetical/historical order.)
- **pipeline before notifications_admin** — admin notifications query `pipeline_ideas`.
- **registration_requests before member_type** — the `member_type` column is created in
  `registration_requests.sql`; `member_type.sql` only re-shapes functions to surface it.

Run them one by one (you'll see `CREATE TABLE` / `CREATE FUNCTION` output; a few harmless
`already exists` notices appear only if you re-run). Verify when done:

```bash
docker compose -f selfhost/docker-compose.yml exec -T db psql -U postgres -d postgres -c "
  select
    (select count(*) from pg_tables  where schemaname='public')        as tables,
    (select count(*) from pg_proc    where pronamespace='public'::regnamespace) as functions,
    (select count(*) from pg_policies where schemaname='public')        as policies,
    (select string_agg(id, ', ') from storage.buckets)                 as buckets;
"
```
Healthy result: ~29 tables, ~110 functions, ~40 policies, buckets `registration-certs, idea-files`.

> **One gotcha that's already fixed:** `profiles` + `handle_new_user` used to live only in the
> Supabase dashboard (never in a file), so a blank DB couldn't bootstrap. They're now captured in
> `db/profiles.sql` (reconstructed from the live cloud schema). That's why `profiles` is step 1.

**Shortcut once you've done it manually:** `./selfhost/apply-schema.sh` runs the exact order above.

---

## 5. Local mail (already wired)

Mailpit is in `selfhost/docker-compose.override.yml` and GoTrue points at it via the `SMTP_*` vars
(step 2). Nothing to do — confirm it works in step 8. **Everything emailed goes to
http://localhost:8025 and never leaves the laptop.**

---

## 6. Edge functions (your 5 Deno functions)

The edge-runtime serves functions from `selfhost/volumes/functions/`. Copy yours in:

```bash
cp -r supabase/functions/_shared \
      supabase/functions/register-request supabase/functions/review-registration \
      supabase/functions/create-member supabase/functions/send-invites \
      supabase/functions/send-contact \
      selfhost/volumes/functions/
docker compose -f selfhost/docker-compose.yml restart functions
```

`SUPABASE_URL` and `SERVICE_ROLE_KEY` are injected into the container automatically. Email-sending
functions use **Resend** (`RESEND_API_KEY`) — leave it unset locally and the best-effort
acknowledgement emails simply no-op (GoTrue's own auth mail still goes to Mailpit). Set
`RESEND_API_KEY` only when you want those function emails to actually send.

---

## 7. Frontend → point at local + run

```bash
cp web/.env.selfhost.example web/.env.local   # sets VITE_SUPABASE_URL=http://localhost:8000 + local anon key
cd web
npm install
npm run dev                                    # serves http://localhost:5173, talking to the local stack
```

Captcha stays **off** locally (it's Cloudflare Turnstile, a cloud service — `VITE_TURNSTILE_SITEKEY`
left unset, so the widget never renders). "Local hosting" for real later = `npm run build` then serve
`web/dist/` (via IIS, nginx, or `npm run preview`).

---

## 8. Smoke test (prove it's all local)

```bash
ANON=$(grep '^ANON_KEY=' selfhost/.env | cut -d= -f2)

# (a) signup an @ifheindia.org email -> allowed by the registration trigger, profile auto-created,
#     confirmation mail caught by Mailpit
curl -s -X POST http://localhost:8000/auth/v1/signup -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@ifheindia.org","password":"Test123456!","data":{"name":"You"}}'
#  -> then open http://localhost:8025 and see "Confirm Your Email"

# (b) public registration request -> edge function inserts a row
curl -s -X POST http://localhost:8000/functions/v1/register-request -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"req@ifheindia.org","member_type":"Student","phone":"","other_text":"","website":""}'
#  -> {"ok":true}
```
Then in the browser at http://localhost:5173: register, log in, read the feed — all served by the
local stack. Make the first user an admin:
```bash
docker compose -f selfhost/docker-compose.yml exec -T db psql -U postgres -d postgres -c \
  "update public.profiles set role='admin' where id=(select id from auth.users where email='you@ifheindia.org');"
```

---

## 9. Reset / teardown

```bash
cd selfhost
docker compose down               # stop containers, keep data
docker compose down -v            # stop AND wipe the database + storage volumes (full reset)
```
After `down -v`, rebuild from step 3.

---

## 10. What changes for real prod (later, NOT on the laptop)

The *inside-the-stack* steps above are identical in prod. Only the edges change:

| Concern | Local (this guide) | Prod |
|---|---|---|
| Secrets | shipped demo keys | regenerate JWT_SECRET + ANON + SERVICE + real POSTGRES_PASSWORD |
| Mail | Mailpit (caught) | **Resend** — GoTrue via its SMTP endpoint (`smtp.resend.com:465`, user `resend`, pass=API key); functions via `RESEND_API_KEY`. Or the college's own SMTP server. |
| Data | blank schema + seed | migrate real users/posts (see `reference/IFN Backend - Self-Host Migration Runbook.md`) |
| TLS / host | `http://localhost`, no domain | HTTPS + domain in front of Kong |
| Captcha | off | real Cloudflare Turnstile keys (lockstep: sitekey + GoTrue secret + edge-fn secret) |
| Frontend | `npm run dev` | `npm run build` served by IIS/nginx |

---

## 11. Prod email — pick a relay (configs ready to paste)

**Mailpit is local-only (it catches, never delivers). For prod you point GoTrue at a real SMTP
relay.** Pick one below. All three are swap-in: edit the `SMTP_*` block in `selfhost/.env` and
`docker compose up -d`.

> **Unavoidable first step for ALL of them:** verify a sending domain (add **SPF + DKIM** DNS
> records on `ifheindia.org` or a subdomain, via ICFAI's DNS admin). Without it, no provider will
> deliver to members — it's how mail proves it isn't spam.

### Option A — AWS SES (recommended once on EC2)
Cheapest at scale (~$0.10 / 1,000 mails), native to EC2. Two gates: verify the domain **and**
request **production access** (SES starts in sandbox = can only email verified addresses).
Generate **SMTP credentials** in the SES console (SMTP Settings → Create SMTP credentials — these
are NOT your AWS access keys).
```ini
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com   # match your EC2 region
SMTP_PORT=587
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
SMTP_ADMIN_EMAIL=no-reply@<your-verified-domain>
SMTP_SENDER_NAME=ICFAI Founders Network
ENABLE_EMAIL_AUTOCONFIRM=false
```

### Option B — Brevo (best free fallback: 300/day)
No EC2 needed, generous free tier. Get the SMTP key from Brevo → **SMTP & API**.
```ini
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<your Brevo SMTP login>
SMTP_PASS=<your Brevo SMTP key>
SMTP_ADMIN_EMAIL=no-reply@<your-verified-domain>
SMTP_SENDER_NAME=ICFAI Founders Network
ENABLE_EMAIL_AUTOCONFIRM=false
```

### Option C — Resend (you already have a key; 3,000/mo)
```ini
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<your re_... API key>
SMTP_ADMIN_EMAIL=no-reply@<your-verified-domain>
SMTP_SENDER_NAME=ICFAI Founders Network
```

### The edge-functions caveat (important)
The 6 lines above only configure **GoTrue** (login/confirm/reset/invite mail). Your **5 edge
functions** (registration ack, invite delivery, contact) send through **Resend's HTTP API**, not
SMTP — they don't speak SMTP. So:

- **Simplest: use Resend for everything** (GoTrue via Resend SMTP = Option C, functions via the
  Resend API). One provider, one verified domain, zero code change.
- **If GoTrue uses SES/Brevo (A/B):** either keep a **Resend key just for the 5 function emails**
  (they're low-volume), or later refactor the functions to send via SMTP (a code change).

To feed the functions their Resend config in the self-host stack, add to the `functions` service
`environment:` in `docker-compose.yml`:
```yaml
      RESEND_API_KEY: ${RESEND_API_KEY}
      MEMBER_FROM_EMAIL: ${MEMBER_FROM_EMAIL}
      INVITE_FROM_EMAIL: ${INVITE_FROM_EMAIL}
      PUBLIC_SITE_URL: ${PUBLIC_SITE_URL}
```
and set those four in `selfhost/.env`.

**Bottom line:** SES for prod scale, Brevo as a free no-infra fallback, Resend if you want one
provider end-to-end. Verify a domain first — that's the only real blocker.
