# IFN, login-only build

The ICFAI Founders Network app, in a build where there is no public sign-up. Admins create every account. This repo is meant to be cloned onto a Windows machine and run from scratch.

## What this is

- A React frontend (Vite) and a self-hosted Supabase backend (Postgres, auth, storage, edge functions), all run with Docker.
- Login-only: no register page, no approve/decline queue. Admins add members from the Admin Panel.
- Login and password reset are protected by a Cloudflare captcha.
- New accounts get a temporary password and must set their own on first login.
- The only email the server sends is the password reset. Welcome and decline emails open the admin's own mail app.

## Start here

If you have never set this up before, follow **[docs/windows-setup.md](docs/windows-setup.md)** top to bottom. It assumes nothing and every command is copy-paste. A PDF of it is in `docs/pdf/` for offline reading.

## Quickstart (if you already know Docker)

```bash
# backend
cd selfhost
cp .env.example .env
docker compose up -d
./apply-schema.sh
cp -r ../supabase/functions/. volumes/functions/ && docker compose up -d functions

# frontend (second terminal)
cd ../web
npm install
npm run dev:local
```

Then make the first admin: Studio at http://localhost:8010 -> Authentication -> Add user (Auto Confirm), copy the id, run the bootstrap SQL from `docs/sql/commands.sql`. App is at http://localhost:5173.

## The docs

| File | What it covers |
|---|---|
| [docs/windows-setup.md](docs/windows-setup.md) | Full step-by-step Windows setup, no assumptions. Start here. |
| [docs/architecture.md](docs/architecture.md) | How the frontend, backend, and containers fit together (with a diagram) |
| [docs/env-reference.md](docs/env-reference.md) | Every important setting in the .env files |
| [docs/frontend-backend.md](docs/frontend-backend.md) | How the browser connects to the backend, and dev vs dev:local |
| [docs/settings-and-debugging.md](docs/settings-and-debugging.md) | What to change before going live, and how to fix common problems |
| [docs/sql-in-studio.md](docs/sql-in-studio.md) | Running SQL in the dashboard |
| [docs/sql/commands.sql](docs/sql/commands.sql) | Ready-to-run SQL: make an admin, change roles, lock posting, health checks |
| [docs/docker-sql.md](docs/docker-sql.md) | Running SQL from the terminal, every argument explained |
| [docs/email-smtp.md](docs/email-smtp.md) | Setting up Resend for real password-reset emails |
| [docs/changing-the-logo.md](docs/changing-the-logo.md) | Swapping the in-app logo, favicon, and email logo |

## Where things run

| Thing | Address |
|---|---|
| App | http://localhost:5173 |
| Dashboard (Studio) | http://localhost:8010 |
| Local email inbox (Mailpit) | http://localhost:8035 |
| Database | localhost:5443, user `postgres` |

## Before you put this on the internet

The defaults are public demo values. Rotate the database password, the JWT secret and its API keys, and the dashboard password, and swap in real captcha and email keys. The checklist is in [docs/settings-and-debugging.md](docs/settings-and-debugging.md).

## Layout

```
web/        the React frontend
db/         the SQL schema (applied by selfhost/apply-schema.sh)
supabase/   edge functions (create-member, etc.)
selfhost/   the Docker stack, config, and helper scripts
docs/       these docs
```
