# Email setup (Resend, for the password-reset mail)

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

[Resend](https://resend.com) is a transactional email service with a free tier (3,000 emails a month, plenty for password resets). Any SMTP provider works (Brevo, SES, Gmail), Resend is just the worked example.

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

## A note on the welcome and decline emails

Those are not sent by the server, so they do not need SMTP at all. When an admin clicks "Send welcome" or "Compose decline" in the Admin Panel, it opens their own email client (Outlook, Gmail, whatever they use) with the message pre-filled, and they press send. This keeps the server's email footprint tiny and avoids putting passwords through a third-party sender.
