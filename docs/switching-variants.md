---
title: Switching between the two IFN variants (login-only ↔ full+registration)
date: 2026-06-24
tags: [ops, deploy, variants]
---

# Switching variants — login-only ↔ full + registration

There are **two app variants** that run on the **same server, host stack, domain,
and Origin cert**. Only **one runs at a time** (both bind 80/443), but each keeps
its **own database**: give each a distinct `COMPOSE_PROJECT_NAME` so their Docker
volumes are separate (`ifnlo_*` vs `ifnfull_*`). Switch with plain **`down`** (keeps
data) — only `down -v` if you deliberately want to wipe that variant.

| | login-only | full + registration |
|---|---|---|
| Repo | `basiilll/ifn` → `~/ifn` | `basiltest/ifn-full` → `~/ifn-full` |
| Compose project | `COMPOSE_PROJECT_NAME=ifnlo` | `COMPOSE_PROJECT_NAME=ifnfull` (set after copying `.env`) |
| Signup | none (admin creates accounts) | self-register → admin approval |
| `ENABLE_EMAIL_SIGNUP` | `false` | `true` |
| GoTrue mail (reset/confirm) | Resend SMTP | **Gmail** SMTP |
| Function mail | directory contact relay (`send-contact`, **Resend** HTTP API) | register/approve/invite (**Resend** HTTP API) |
| Edge functions | `create-member`, `send-contact` | `register-request`, `review-registration`, `send-invites`, `send-contact`, … |

## What decides "which version is running"
All of these come from **whichever repo dir you bring the stack up from** (plus `.env`):
1. **Frontend** — Caddy bind-mounts that repo's `web/dist` (`../web/dist:/srv/app`).
2. **Edge functions** — mounted from that repo's `selfhost/volumes/functions`. **No deploy step** (self-hosted edge-runtime serves the mounted files).
3. **DB schema** — loaded by that repo's `apply-schema.sh`. Same Postgres image; only the SQL differs.
4. **`ENABLE_EMAIL_SIGNUP`** + the email vars in that repo's `selfhost/.env`.

Both repos **share the same `selfhost/.env` secrets** (JWT/keys/domain) so the
backend matches whichever frontend — **except `COMPOSE_PROJECT_NAME`**, which must
differ (`ifnlo` vs `ifnfull`) so each keeps its own volumes. Only the signup flag +
email vars + project name + frontend + schema change between them.

## One-time setup per variant
Each variant needs its `COMPOSE_PROJECT_NAME` set + (for full) the email/signup vars:
```bash
# after copying the shared .env into a variant, give it its own project name:
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=ifnfull/' ~/ifn-full/selfhost/.env   # (ifnlo for ~/ifn)
```
For full, also set in `~/ifn-full/selfhost/.env`: `ENABLE_EMAIL_SIGNUP=true`, Gmail
`SMTP_*`, `RESEND_API_KEY`, `*_FROM_EMAIL`, `PUBLIC_SITE_URL`, `TURNSTILE_SECRET`;
and in `~/ifn-full/web/.env.production`: domain URL + anon key + Turnstile sitekey.

## Switch: login-only → full
```bash
# stop login-only (KEEP its db volume — no -v)
cd ~/ifn/selfhost      && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml down
# build + start full on its own volumes
cd ~/ifn-full/web      && npm ci && npm run build
cd ~/ifn-full/selfhost && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
# load the full schema ONLY the first time ifn-full's volume is created:
cd ~/ifn-full          && sudo ./selfhost/apply-schema.sh
```

## Switch: full → login-only
```bash
cd ~/ifn-full/selfhost && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml down
cd ~/ifn/web           && npm ci && npm run build
cd ~/ifn/selfhost      && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
# apply-schema only if ifnlo's volume was wiped; otherwise its data is still there
```

## After any switch
- **First time a variant's volume is created → no admin.** Bootstrap one: Studio over Tailscale
  (`tailscale serve --bg --https=8443 http://127.0.0.1:8003` → the `ts.net` URL) →
  Authentication → Add user (auto-confirm) → then
  `update public.profiles set role='admin', onboarded=true where id='<uid>';`
  (login-only also set `must_change_password=false`).
- **Verify:** `docker compose -f docker-compose.yml -f docker-compose.caddy.yml ps`
  (all healthy), then load the site (hard-refresh) and test the auth flow.
- Cloudflare Origin cert, `cf-lock.service`, ufw, and the domain are **unchanged** —
  they belong to the host/stack, not the variant.
- If you restarted the Docker **daemon** at any point, re-run
  `sudo systemctl start cf-lock.service` (gotcha #9 in the maintenance runbook).

## Notes / gotchas
- Only one variant can run — both publish 80/443 (+ 8003/5443). `down` the current
  one first (plain `down`, so its volumes survive).
- **Distinct `COMPOSE_PROJECT_NAME` is what keeps the two databases separate.** If
  both share a name (e.g. you forgot to change ifn-full's after copying `.env`),
  they share volumes and switching clobbers state.
- `down -v` (with `-v`) wipes that project's DB volume — only use it intentionally.
  Back up first if there's real data (`ifn-backup.sh`).
- Frontend env (`web/.env.production`) is **baked at build time** — always
  `npm run build` after switching; verify with `grep -r icfaifoundersnetwork.app web/dist`.
- Edge functions need **no deploy** — they're bind-mounted and live on `up`.
- See `docs/session-2026-06-24-changes-and-aws-migration.md` for the full deploy
  details and AWS migration path.
