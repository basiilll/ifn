# How the frontend talks to the backend

Short version: the browser reads one URL and one key from a config file, and sends all its requests to that URL. The key tells the backend "I am an anonymous visitor", and your login session takes it from there.

## The connection in one picture

```
Browser (localhost:5173)
   |
   |  every API call goes to VITE_SUPABASE_URL
   v
Kong gateway (localhost:8010)
   |-- /auth/v1/...     -> GoTrue (login, reset)
   |-- /rest/v1/...     -> PostgREST (read/write tables)
   |-- /storage/v1/...  -> Storage (file uploads)
   |-- /functions/v1/...-> Edge functions (create member, etc.)
   v
Postgres database
```

## The two settings that wire them together

In `web/.env.selfhost`:

- `VITE_SUPABASE_URL=http://localhost:8010` tells the app where the backend is.
- `VITE_SUPABASE_ANON_KEY=...` is the public key the app sends with every request.

The app's `web/src/lib/supabase.js` reads those two and creates the client that the whole frontend uses. That is the only wiring. Change the URL, and the app points somewhere else.

## dev vs dev:local (this trips people up)

| Command | Reads | Points at |
|---|---|---|
| `npm run dev` | `web/.env.local` | the live CLOUD database |
| `npm run dev:local` | `web/.env.selfhost` | your LOCAL backend on :8010 |

For this self-hosted setup, **always use `npm run dev:local`**. Plain `npm run dev` would talk to production, which you usually do not want while testing.

`npm run build` makes the production bundle and points at the cloud by default. For a self-hosted production build you would set the build to use the self-host URL, which is a deploy-time detail covered when you actually deploy.

## "Is the anon key a security hole?"

No. It is meant to be public and it ships in the browser bundle. The real protection is in the database: every table has Row Level Security rules that decide, per row, what each logged-in user can read or change. The anon key by itself lets you do almost nothing. This is the standard Supabase model, and reviewers flag it constantly without understanding it.

## How a login actually flows

1. You type email and password and solve the captcha on `localhost:5173/login`.
2. The app sends them (plus the captcha token) to `localhost:8010/auth/v1/token`.
3. GoTrue checks the password and the captcha, and returns a session token.
4. The app stores that token and sends it with every later request.
5. The database sees the token, knows who you are, and applies the security rules.

If login fails with a captcha error, the sitekey (frontend) and secret (backend) are not a matching pair. See `docs/settings-and-debugging.md`.

## Connecting from outside the browser (optional)

If you want to poke the API with a tool like Postman or curl, the base URL is `http://localhost:8010` and you send the anon key as both an `apikey` header and a `Authorization: Bearer <anon key>` header. Example:

```bash
curl http://localhost:8010/rest/v1/profiles?select=name \
  -H "apikey: PASTE_ANON_KEY" \
  -H "Authorization: Bearer PASTE_ANON_KEY"
```

You get back only what the anonymous role is allowed to see, which for most tables is nothing until you log in.
