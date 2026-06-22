
## What sends email in this app

Almost nothing. This is a login-only build:

- Welcome emails and decline emails open the admin's own mail app (a `mailto:` link). The server does not send those.
- The ONLY email the server sends is the **password-reset** mail, from the auth server (GoTrue) over SMTP.

So all you need is one working SMTP connection, and you only need it in production. Locally, reset mail is caught by Mailpit at http://localhost:8035 and nobody has to receive anything.

## Local: nothing to do

The template already points GoTrue at Mailpit:

```
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
```

Trigger a reset from the app, then open http://localhost:8035 to read it. Done.

## Production: point GoTrue at Resend

[Resend](https://resend.com) is a transactional email service with a free tier (**100 emails a day, 3,000 a month** — plenty for password resets). Any SMTP provider works, Resend is just the worked example. If you would rather use a Gmail / Google Workspace account, skip to [Alternative: Gmail / Google Workspace SMTP](#alternative-gmail--google-workspace-smtp) below.

### Step 1: make a Resend account and verify a domain

1. Sign up at https://resend.com.
2. Go to **Domains**, add the domain you will send from (for example `ifheindia.org` or a subdomain like `mail.ifheindia.org`).
3. Resend shows you a few DNS records (SPF, DKIM). Add them at your domain's DNS provider. This proves you own the domain so your mail does not land in spam.
4. Wait for Resend to show the domain as **Verified** (minutes to a few hours).

### Step 2: get an API key

1. In Resend, go to **API Keys**, create one, copy it. It looks like `re_xxxxxxxx`.
2. This key is the SMTP password.

### Step 3: put it in `selfhost/.env`

Resend's SMTP server uses the literal username `resend` and your API key as the password:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_PASTE_YOUR_API_KEY
SMTP_ADMIN_EMAIL=no-reply@your-verified-domain.org
SMTP_SENDER_NAME=ICFAI Founders Network
```

Notes:
- Port `465` is SSL. If `465` is blocked on your network, use `587` instead.
- `SMTP_ADMIN_EMAIL` is the "from" address. It MUST be at the domain you verified in step 1, or Resend rejects it.

### Step 4: restart the auth server

```bash
cd selfhost
docker compose up -d auth
```

### Step 5: test it

In the app, go to **Forgot password**, enter a real address you can check, and submit. The mail should arrive within a minute. If it does not, watch the auth log while you try:

```bash
docker compose logs -f auth
```

Common issues:
- "from address not allowed" or similar: your `SMTP_ADMIN_EMAIL` is not on the verified domain.
- Connection timeout: port 465 is blocked, try 587.
- Lands in spam: the DNS records (SPF/DKIM) are not fully set or not propagated yet.

## Alternative: Gmail / Google Workspace SMTP

You can point GoTrue at Gmail instead of Resend. **No code changes** — it is the same `SMTP_*`
block, just different values. Good if you already have a Google account and do not want to
verify a domain. The trade-offs vs Resend:

- **Send limits:** a free `@gmail.com` account allows ~**500 emails/day**; paid **Google
  Workspace** allows ~**2,000/day**. Far more than password resets need.
- **From address is locked:** Gmail forces the "from" to be your own Google address. You cannot
  send as `no-reply@your-domain` (Workspace can, only for verified domain aliases).
- **Deliverability is weaker** for app mail — transactional messages from a personal Gmail more
  often land in spam than a domain-verified Resend sender.

### Step 1: turn on 2-Step Verification + make an App Password

Gmail will not accept your normal password over SMTP. You need a 16-character **App Password**:

1. Go to https://myaccount.google.com/security and enable **2-Step Verification** (required).
2. Then open **App passwords** (https://myaccount.google.com/apppasswords), create one (name it
   e.g. "IFN auth"), and copy the 16-character code. It looks like `abcd efgh ijkl mnop` —
   paste it **without** the spaces.

> Workspace admins can disable App Passwords. If you do not see the option, use Resend, or have
> the Workspace admin enable it / set up the [Google SMTP relay](https://support.google.com/a/answer/2956491).

### Step 2: put it in `selfhost/.env`

The username is your full Gmail address; the password is the App Password from step 1:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=youraddress@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_ADMIN_EMAIL=youraddress@gmail.com
SMTP_SENDER_NAME=ICFAI Founders Network
```

Notes:
- Port `465` is SSL. If it is blocked, use `587` (STARTTLS).
- `SMTP_ADMIN_EMAIL` (the "from") **must equal** `SMTP_USER` — Gmail rewrites or rejects a
  mismatched from address.

### Step 3: restart auth and test

Same as the Resend steps — restart the auth container, then trigger a reset:

```bash
cd selfhost
docker compose up -d auth
docker compose logs -f auth   # watch while you send a test reset
```

Common Gmail-specific issues:
- `535 5.7.8 Username and Password not accepted`: you used your normal password, not an App
  Password, or 2-Step Verification is off.
- `534 ... Application-specific password required`: same fix — generate an App Password.
- Mail sends but lands in spam: expected for personal Gmail; for better delivery use Resend with
  a verified domain, or Google Workspace with a domain alias.

## The password-reset email template (branding it)

By default GoTrue sends its **built-in** recovery email. That default always includes an
"Alternatively, enter the code: 123456" line (an OTP). This app's reset flow only uses the
**link** (`/reset-password`) — it has no screen to type that code — so the line is just
confusing noise.

This repo ships a **custom, branded** recovery template that drops the code and shows the logo:

- **Template file:** `selfhost/volumes/auth/templates/recovery.html` (edit the copy/colours here).
- **Served over HTTP** by a tiny `mail-templates` (nginx) sidecar on the internal Docker network.
  GoTrue **fetches the template body over HTTP — `file://` paths are NOT supported** by its mailme
  client (it silently falls back to the default template, which is the trap to avoid). The sidecar
  exposes the html as `http://mail-templates/recovery.html`.
- **Switched on** by two vars in `selfhost/.env`:

  ```
  MAILER_SUBJECTS_RECOVERY="Reset your ICFAI Founders Network password"
  MAILER_TEMPLATES_RECOVERY=http://mail-templates/recovery.html
  ```

  Leave **both unset** to fall back to GoTrue's default template.

The template uses two GoTrue variables: `{{ .ConfirmationURL }}` (the reset link) and
`{{ .SiteURL }}` (used to build the logo image URL `{{ .SiteURL }}/email/icfai-founders.png`).

> Why a sidecar and not a file mount? GoTrue v2.189 (`supabase/auth`) loads
> `GOTRUE_MAILER_TEMPLATES_*` by HTTP GET. A `file:///…` URL fails the fetch and GoTrue quietly
> uses its built-in template, leaving the "enter the code" line in place. Serving the html over
> HTTP is the reliable fix. Verify GoTrue can reach it with:
> `docker compose exec auth wget -qO- http://mail-templates/recovery.html`.

**On Windows.** The `mail-templates` sidecar is plain Docker, so it runs the same under Docker
Desktop (WSL2) — no change needed. `docker compose up -d` brings it up alongside `auth`, and
GoTrue reaches it over the internal Docker network exactly as on Linux. The `:z` flag on the
mount is a Linux/SELinux hint that Docker Desktop ignores, and Windows CRLF line endings in the
`.html` don't affect nginx or GoTrue. The only thing that won't follow the repo to a new machine
is `selfhost/.env` (it's gitignored) — recreate it from `selfhost/.env.example` and re-add your
`SMTP_*` and `MAILER_*` lines.

> **Logo in email needs a public URL.** Email clients fetch the logo over the internet, so it
> only renders when `SITE_URL` is a real public address. Locally (`SITE_URL=http://localhost:...`)
> Gmail cannot reach the image and shows the alt text instead — that's expected. In production
> set `SITE_URL` to your deployed site and the logo loads.

### Editing the template

The one file to edit is:

```
selfhost/volumes/auth/templates/recovery.html
```

Change the wording, colours, button, or logo there — it is plain HTML with inline CSS (keep CSS
inline; email clients ignore `<style>`/external stylesheets). The two GoTrue placeholders
`{{ .ConfirmationURL }}` and `{{ .SiteURL }}` must stay.

To add **another** email (e.g. invite or email-confirmation), drop a new `.html` next to it in the
same folder and point the matching var at it — the sidecar serves everything in that directory:

```
MAILER_TEMPLATES_INVITE=http://mail-templates/invite.html
MAILER_TEMPLATES_CONFIRMATION=http://mail-templates/confirmation.html
```

(and add the corresponding `GOTRUE_MAILER_TEMPLATES_*` lines on the `auth` service in
`docker-compose.yml`, mirroring the recovery ones).

### Applying a change

After editing the template **or** the `MAILER_*` vars, recreate auth so it re-reads them:

```bash
cd selfhost
docker compose up -d auth
```

GoTrue caches templates, so `up -d auth` recreates the container and reloads. (The nginx sidecar
already serves the new file immediately; it's GoTrue's cache that needs the bounce.) A plain
`docker compose restart auth` will **not** pick up `.env` changes — use `up -d`.

## A note on the welcome and decline emails

Those are not sent by the server, so they do not need SMTP at all. When an admin clicks "Send welcome" or "Compose decline" in the Admin Panel, it opens their own email client (Outlook, Gmail, whatever they use) with the message pre-filled, and they press send. This keeps the server's email footprint tiny and avoids putting passwords through a third-party sender.
