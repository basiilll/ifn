# The self-host folder layout (`selfhost/`)

What every folder under `selfhost/` is for, in plain terms. You rarely touch most of these — but
when something needs changing, this tells you which file and which container it belongs to.

## `selfhost/volumes/` — the config you hand to the containers

Each container is a **sealed appliance**. `volumes/` holds the settings, scripts, and files that
get **mounted into** those appliances at startup (Docker calls these bind mounts). Edit a file
here, restart that one container, and it picks up the change. Nothing here is "the app" — it's the
configuration the app's containers read from outside.

| Folder | Mounted into | What it is, plainly |
|---|---|---|
| `volumes/api/` | `kong` (the gateway) | The gateway's routing table (`kong.yml`) — which URL path goes to which service — plus its entrypoint. (An `envoy/` variant lives here too.) |
| `volumes/auth/` | `auth` (GoTrue) | Branded auth **email templates**. Currently `templates/recovery.html`, the password-reset email (served to GoTrue over HTTP by the `mail-templates` sidecar — see [email-smtp.md](email-smtp.md)). |
| `volumes/db/` | `db` (Postgres) | SQL that runs when the **database first boots** — sets up Supabase's internal roles, JWT, pooler, realtime, webhooks. `db/init/` only runs on a blank database. |
| `volumes/functions/` | `functions` (Deno) | The actual **Edge Function** code — `create-member` (admin account provisioning), `send-contact` (Directory contact relay), and shared helpers. The only hand-written server code in the stack. |
| `volumes/logs/` | `vector` | Log-shipping config (`vector.yml`) — collects and routes container logs. |
| `volumes/pooler/` | `supavisor` | Connection-pooler settings (`pooler.exs`). |
| `volumes/proxy/` | reverse proxy | Caddy and nginx configs (`Caddyfile`, `supabase-nginx.conf.tpl`) for the public-facing proxy used when fronting the stack in production. |
| `volumes/snippets/` | `studio` | Saved SQL snippets shown in the Studio dashboard's SQL editor (e.g. `make admin user.sql`). |

> **Key point about `volumes/db/`:** its SQL runs **only on a fresh database**. It is not re-applied
> on restart. So a data problem on an already-running DB (e.g. a user missing their `profiles` row)
> is fixed with a SQL command, not by restarting — see [docs/sql-in-studio.md](sql-in-studio.md).

## `selfhost/tests/` — stack smoke tests

Integration tests that check the **stack** is healthy (not the IFN app logic — that lives in
`db/*.sql`). Most take an optional `<base_url>` (default `http://localhost:8000`) and need a
running stack + `.env` + `jq`.

| File | Checks |
|---|---|
| `test-self-hosted.sh` | End-to-end smoke: auth + REST + storage round-trip. The main "is it alive" test. |
| `test-auth-keys.sh` | API key types and asymmetric (JWT) auth. |
| `test-container-logs.sh` | Greps each service's logs to confirm every container started cleanly. |
| `test-pg17-upgrade.sh` | Postgres 15 → 17 upgrade: seed on PG15, upgrade, verify integrity via pgTAP. |
| `test-s3.sh` | The S3-compatible Storage endpoint (`/storage/v1/s3`), as aws-cli/rclone users hit it. |
| `test-s3-backend.sh` | The raw S3 backend (MinIO/RustFS) directly, bypassing Storage. |
| `docker-compose.s3.test.yml` / `…rustfs.test.yml` | Compose overrides that expose the S3 backend port for the two tests above. |

## `selfhost/utils/` — one-off operational scripts

Admin/ops helpers you run at setup, on a secret rotation, or a version bump. The key scripts
accept `--update-env` (write straight to `.env`) or print-only.

| File | Does |
|---|---|
| `generate-keys.sh` | Fresh install: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (legacy symmetric HS256). |
| `add-new-auth-keys.sh` | Adds the newer **asymmetric** auth: EC P-256 pair (`JWT_KEYS`/`JWT_JWKS`) + opaque API keys. |
| `rotate-new-api-keys.sh` | Rotates only the opaque API keys, leaving the JWKS pair + JWT tokens intact. |
| `db-passwd.sh` | Changes the Postgres password across all Supabase roles/services safely. |
| `reassign-owner.sh` | Reassigns public-schema ownership `supabase_admin` → `postgres` (hardening: remove superuser access). |
| `upgrade-pg17.sh` | The Postgres 15 → 17 in-place upgrade engine (bash + sudo). `tests/test-pg17-upgrade.sh` validates it. |

> **Symmetric vs asymmetric (keys above):** *symmetric* (HS256) uses one shared secret
> (`JWT_SECRET`) to both sign and verify tokens — anything holding it can mint logins. *Asymmetric*
> (ES256) signs with a private key and verifies with a public one (JWKS), so services can verify
> tokens without ever holding signing power.
