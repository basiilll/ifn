# Environment settings reference

There are two config files. This explains the fields you actually care about.

## `selfhost/.env` (the backend)

You create this by copying `selfhost/.env.example`. It is not in git because it can hold secrets.

### Secrets (rotate all of these before going live)

| Field | What it is | Default in the template |
|---|---|---|
| `POSTGRES_PASSWORD` | Password for the database superuser | a public demo value |
| `JWT_SECRET` | The master key that signs every login token | a public demo value |
| `ANON_KEY` | Public API key that the browser uses | demo, derived from `JWT_SECRET` |
| `SERVICE_ROLE_KEY` | Server-only key that bypasses all security. Never put it in the browser. | demo |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Login for Studio at localhost:8010 | `supabase` / a demo password |

These default values are public knowledge (they ship with Supabase). Fine on your laptop, dangerous on the internet. To rotate the keys, run `selfhost/utils/generate-keys.sh` and paste the output in. See `docs/settings-and-debugging.md`.

### This fork's custom settings (already set in the template)

| Field | Value | Why |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `ifnlo` | Gives this stack its own containers and database, so it can run next to other Supabase stacks without clashing |
| `KONG_HTTP_PORT` | `8010` | The port the API and Studio listen on |
| `KONG_HTTPS_PORT` | `8453` | HTTPS version, rarely used locally |
| `POOLER_PROXY_PORT_TRANSACTION` | `6553` | Database pooler port |
| `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` | `http://localhost:8010` | So login links and the dashboard point at the right place |
| `SITE_URL` | `http://localhost:5173` | Where the frontend runs, used for email links |
| `ADDITIONAL_REDIRECT_URLS` | `http://localhost:5173/**` | Lets the password-reset link redirect back to the app |
| `DISABLE_SIGNUP` | `true` | No public sign-up. Admins create accounts. |

### Captcha (Cloudflare Turnstile)

| Field | Value | Why |
|---|---|---|
| `CAPTCHA_ENABLED` | `true` | Turns on captcha for login and password reset |
| `CAPTCHA_PROVIDER` | `turnstile` | We use Cloudflare Turnstile |
| `CAPTCHA_SECRET` | a dev always-pass secret | The server-side half of the captcha. Swap your real one for production. |

The public half (the sitekey) lives in the frontend file, see below. The two must be a matching pair from the same Cloudflare widget.

### Email (only used for password reset)

| Field | Value | Why |
|---|---|---|
| `SMTP_HOST` | `mailpit` | Locally, mail goes to Mailpit (caught, not really sent) |
| `SMTP_PORT` | `1025` | Mailpit's inbound port (inside Docker) |
| `SMTP_USER` / `SMTP_PASS` | empty | Mailpit needs no login. For real sending, fill these (see `docs/email-smtp.md`) |
| `SMTP_ADMIN_EMAIL` | `no-reply@ifn.local` | The "from" address |

## `web/.env.selfhost` (the frontend, local mode)

This one is in git (no secrets). It is loaded only by `npm run dev:local`.

| Field | Value | Why |
|---|---|---|
| `VITE_SUPABASE_URL` | `http://localhost:8010` | Where the browser sends API calls (your local Kong) |
| `VITE_SUPABASE_ANON_KEY` | the demo anon key | Public key, safe to ship. Must match `ANON_KEY` in the backend. |
| `VITE_TURNSTILE_SITEKEY` | a dev always-pass sitekey | The public half of the captcha. Swap your real one for production, and keep it matched with `CAPTCHA_SECRET`. |

There is also `web/.env.local` (not in git) which points at the live cloud database. That is what plain `npm run dev` uses. For this self-hosted setup you do not need it.

## The golden rule

If you change `JWT_SECRET`, you MUST also regenerate `ANON_KEY` and `SERVICE_ROLE_KEY` to match, and update `VITE_SUPABASE_ANON_KEY` in the frontend. They are a set. Changing one and not the others breaks login. The `generate-keys.sh` script does all of them together.
