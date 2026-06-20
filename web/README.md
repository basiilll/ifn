# IFN web (Vite + React SPA)

The ICFAI Founders Network frontend. Vite + React, Tailwind CSS, React Router, talking directly
to Supabase (Auth + Postgres + RLS). No separate backend. Design: `../architecture.md`. Live DB
schema and apply order: `../db/README.md`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the build
npm run lint
```

Environment (`.env` / Vercel env vars):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The anon key is public; it is safe only because Row Level Security guards every table. The
service_role key must never be put here.

## Structure

```
src/
  lib/         supabase client, AuthProvider, options, format, calendar, postKind
  components/  Layout, Topbar, SideNav, RightSidebar, ProtectedRoute, OnboardingGate,
               PostCard, CreatePostModal, Dropdown, RoleBadge, skeletons
  pages/       Login, Register, ForgotPassword, ResetPassword, Onboarding,
               Feed, PostDetail, TeamAcquisition, Calendar, Directory,
               Profile, Settings, AdminPanel
  assets/      icfai-founders.svg (inlined via vite-plugin-svgr)
public/        favicon.svg (IFN brand tile)
vercel.json    SPA fallback rewrite + CSP/security headers
```

## Notes
- Routing guards: `PublicOnlyRoute` (login/register), `ProtectedRoute` (session + banned wall),
  `OnboardingGate` (first-time users to `/onboarding`).
- The SQL that backs every feature lives in `../db/*.sql` and is applied by hand in the Supabase
  SQL editor. After pulling changes, re-run any changed `db/*.sql` before the new UI will work.
- Deployed on Vercel (root dir = `web/`). Pushing to `main` triggers a redeploy.
