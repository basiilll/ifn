# Changing the logo

The logo shows up in **three** places. They are separate files — changing one does **not**
change the others. Pick the ones you care about.

| Where you see it | File to change | Format |
|---|---|---|
| **Inside the app** (login, onboarding, password screens, loading spinners — 9 spots) | `web/src/assets/icfai-founders.svg` | SVG |
| **Browser tab icon** (favicon) | `web/public/favicon.svg` | SVG |
| **Password-reset email** | `web/public/email/icfai-founders.png` | PNG |

> Heads up: there are stray files `web/src/assets/icfai-founders.png` and
> `icfai-founders.orig.png`. **Nothing uses them** — the app renders the `.svg`, not these.
> Replacing the PNGs will not change the app logo. You can ignore or delete them.

---

## 1. The in-app logo (the main one)

This is what almost everyone means by "the logo." It is one SVG, rendered everywhere through
`web/src/components/Logo.jsx`. Change the file, and all 9 places update at once.

**File:** `web/src/assets/icfai-founders.svg`

### Option A — you have a new SVG (best)

1. Replace `web/src/assets/icfai-founders.svg` with your new file (keep the same filename).
2. Restart the frontend (`npm run dev`, or rebuild for production).

That's it. Two things make the swap clean:

- **Keep a `viewBox`.** The current one is `viewBox="76.495 183.479 347 132"` (≈ 347×132, a wide
  wordmark). The app sizes the logo with CSS height (e.g. `h-10`) and lets width follow the
  aspect ratio. If your SVG has a very different shape, it will still render — just check the
  login and onboarding screens so it isn't stretched or tiny.
- **(Optional) `currentColor` for tinting.** In the current logo, the big "ICFAI" letters use
  `fill="currentColor"`, so they pick up the brand accent colour automatically
  (`Logo.jsx` adds `className="text-accent"`). The red bar (`#E31E24`) and the reversed
  "FOUNDERS NETWORK" text use fixed colours. If you want your logo to follow the theme accent,
  set the relevant fills to `currentColor`; if you want fixed colours, just hard-code them and
  ignore the accent.

No code change is needed — `Logo.jsx` imports the SVG by name:

```jsx
// web/src/components/Logo.jsx
import LogoSvg from '../assets/icfai-founders.svg?react'
```

The `?react` turns the SVG into a React component at build time (Vite + `vite-plugin-svgr`),
which is why `currentColor` and CSS sizing work.

### Option B — you only have a PNG / JPG

Inline-SVG tricks (accent tint, crisp scaling) won't apply, so render it as an image instead.

1. Drop your file in `web/src/assets/`, e.g. `web/src/assets/logo.png`.
2. Edit `web/src/components/Logo.jsx`:

```jsx
import logoUrl from '../assets/logo.png'

export default function Logo({ className = '' }) {
  return <img src={logoUrl} className={className} alt="ICFAI Founders Network" />
}
```

3. Restart the frontend.

Use a transparent PNG (or one with a matching background) and a height around 2× the display
size (the app shows it ~40px tall, so ship ~80px+ tall for sharpness on retina screens).

---

## 2. The favicon (browser tab icon)

**File:** `web/public/favicon.svg`, referenced once in `web/index.html`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

Replace `web/public/favicon.svg` (keep the name) and hard-refresh the browser (favicons cache
hard — try a private window if it looks stale). To use a `.png`/`.ico` instead, drop it in
`web/public/` and update the `href` + `type` in `web/index.html`.

A favicon should be a **simple, square** mark — the wide wordmark shrinks to mush at 16px. Use
the icon/monogram part of your brand, not the full wordmark.

---

## 3. The email logo (password-reset mail)

**File:** `web/public/email/icfai-founders.png`

The password-reset email template points at this image by URL. **It must be a publicly
reachable raster image** (PNG/JPG) — email clients can't inline-render app SVGs and won't load
anything behind a login. Replace it with a same-named PNG, hosted at the same public path on
your deployed site. Keep it modestly sized (≈ 400–600px wide) so it loads fast in mail clients.

---

## After changing anything

- **Dev:** restart `npm run dev` so Vite re-bundles assets.
- **Production:** rebuild and redeploy the `web/` app (a fresh `dist/`).
- **Check it everywhere:** open `/login`, `/onboarding`, the browser tab, and trigger a
  password-reset email (locally these land in Mailpit at http://localhost:8035 — see
  [email-smtp.md](email-smtp.md)).
