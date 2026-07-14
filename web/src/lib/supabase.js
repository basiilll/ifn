import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env.local (dev) and in your host env (Cloudflare Pages / Vercel).'
  )
}

// autoRefreshToken: false is deliberate and load-bearing (audit Case II).
//
// By default supabase-js silently trades the refresh token for a fresh JWT on a timer, whether or
// not the user did anything, so a session never ends. We want a hard 20-minute session that always
// ends in a real password prompt, so the client never renews: the JWT issued at login simply
// expires (JWT_EXPIRY=1200) and the user logs in again.
//
// This must stay in step with GOTRUE_SESSIONS_TIMEBOX=20m, which is the server-side half — the
// client is not a security control on its own. Turning auto-refresh back on without also raising
// the timebox would give ~39 min, not 20: a refresh at 19:30 still passes the timebox check and
// mints a JWT good for another full JWT_EXPIRY (see auth sessions.go CheckValidity).
//
// Trade-off accepted by the product owner: an active user is signed out mid-task every 20 minutes.
// useSessionExpiry() turns that into a clean redirect instead of a wall of 401s.
export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false },
})
