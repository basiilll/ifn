# Settings you can change, and how to debug

Two parts: what you might want to change, and how to figure out what is wrong when something breaks.

## Part 1: things you will want to change

### Before putting this on the internet

Do all of these. The defaults are public knowledge and safe only on a private machine.

1. **Rotate the database and dashboard passwords**
   ```bash
   cd selfhost
   ./utils/db-passwd.sh                 # changes the Postgres password the right way
   # then edit selfhost/.env: set a new DASHBOARD_PASSWORD
   docker compose up -d kong            # picks up the new dashboard password
   ```

2. **Rotate the API keys (the big one)**
   ```bash
   cd selfhost
   ./utils/generate-keys.sh             # prints a new JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY
   # paste all three into selfhost/.env (replace the demo ones)
   docker compose down && docker compose up -d
   # then update web/.env.selfhost: VITE_SUPABASE_ANON_KEY = the new ANON_KEY
   ```
   This logs everyone out (old tokens stop working). Do it once, early.

3. **Use real captcha keys.** Get them from the Cloudflare dashboard (Turnstile, add a widget, list `localhost` and your real domain as allowed hostnames). Put the **sitekey** in `web/.env.selfhost` (`VITE_TURNSTILE_SITEKEY`) and the **secret** in `selfhost/.env` (`CAPTCHA_SECRET`). They must come from the same widget. Then `docker compose up -d auth` and restart the frontend.

4. **Use real email.** See `docs/email-smtp.md`. Without it, password-reset emails only land in Mailpit (local), nobody receives them for real.

### Turning posting on or off, and other admin switches

These are in the app, not in config. Log in as an admin, go to the **Admin Panel**, **Settings** tab. From there you can lock posting, lock pipeline submissions, and so on. The database enforces these, the buttons just flip a flag.

### Changing ports

The stack uses 8010 (API and Studio), 8035 (Mailpit), 5443 and 6553 (database). If one is already taken on your machine, change it in `selfhost/.env` (`KONG_HTTP_PORT`, etc.) and in `selfhost/docker-compose.override.yml` for Mailpit, then update `VITE_SUPABASE_URL` in `web/.env.selfhost` to match the new API port.

## Part 2: how to debug

### Step one, always: look at the logs

Most problems show up in a container's log.

```bash
cd selfhost
docker compose logs -f auth          # the login server (most useful)
docker compose logs -f kong          # the gateway
docker compose logs -f db            # the database
docker compose logs --tail=50 functions   # edge functions, last 50 lines
```

`-f` means "follow" (keep streaming). Press Ctrl+C to stop watching. Do an action in the app and watch what the log prints.

### Step two: the browser console

In the browser, press F12, click the **Console** tab. Red lines are errors. Click the **Network** tab to see the actual API calls, their status codes, and responses. A request in red with status 400 or 401 tells you which call failed.

### Common problems and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Login fails with a captcha error | sitekey and secret are not a matching pair | Make sure `VITE_TURNSTILE_SITEKEY` (frontend) and `CAPTCHA_SECRET` (backend) come from the same Cloudflare widget, then restart auth + frontend |
| `apply-schema.sh` shows red `✗` lines | a SQL file failed | Run it again (`./apply-schema.sh`), the two-pass run resolves most ordering issues. If it still fails, read the error line, it names the missing table or function |
| App loads but every request fails | frontend pointing at the wrong place, or backend not up | Check `docker compose ps` shows healthy containers, and `VITE_SUPABASE_URL` is `http://localhost:8010` |
| "port is already allocated" on `up` | another program (maybe another Supabase) uses that port | Change the ports (see above), or stop the other stack |
| Password-reset email never arrives | only Mailpit is configured | Open Mailpit at http://localhost:8035 to see it locally, or set up real SMTP (`docs/email-smtp.md`) |
| Login works but the user is stuck on "set a new password" | that account has `must_change_password = true` | Normal for admin-created accounts. They set their own password and continue. To skip it for one account, run the SQL in `docs/sql/commands.sql` |
| Changes to `.env` did nothing | the container did not restart | `docker compose up -d <service>` re-reads env. For `JWT_SECRET` do a full `down` then `up -d` |
| Changes to `web/.env.selfhost` did nothing | Vite reads env only at start | Stop the frontend (Ctrl+C) and run `npm run dev:local` again |

### Step three: check the database directly

If you suspect the data is wrong, open Studio at http://localhost:8010, use the Table Editor or the SQL Editor. Or from a terminal, see `docs/docker-sql.md` to run SQL straight against the database.

### When all else fails

`docker compose down && docker compose up -d` restarts everything cleanly without losing data. If the database itself is broken and you are OK losing local data, you can reset it, but that deletes everything, so back up first (see `docs/docker-sql.md` for `pg_dump`).
