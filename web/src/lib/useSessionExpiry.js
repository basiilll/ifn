import { useEffect } from 'react'
import { supabase } from './supabase'

// Hard session expiry (NIC secure-code checklist item 20 / audit Case II).
//
// supabase.js sets autoRefreshToken:false, so the JWT minted at login dies at JWT_EXPIRY (1200s)
// and GOTRUE_SESSIONS_TIMEBOX=20m destroys the session server-side at the same moment. Nothing
// renews either. This hook is what turns that into a clean redirect: without it the app would sit
// on a dead token firing 401s until the user happened to click something. On expiry we signOut(),
// AuthProvider's listener clears the session, and ProtectedRoute sends them to /login.
//
// This replaces the old useIdleLogout: a 20-minute idle timer can never fire before a session that
// already dies 20 minutes after login, so it was dead code once the timebox went to 20m. Restore
// it if SESSIONS_TIMEBOX is ever relaxed back to a normal value, since then idle would bite first.
//
// Wall-clock comparison on a poll rather than one long setTimeout: a backgrounded tab can have its
// timers frozen or throttled and the machine can sleep, so a lone timer fires late or never.
const CHECK_MS = 15 * 1000

export function useSessionExpiry(expiresAt) {
  useEffect(() => {
    if (!expiresAt) return
    let done = false
    const check = () => {
      if (done || Date.now() < expiresAt * 1000) return
      done = true // signOut is async; don't fire it on every tick while the session clears
      supabase.auth.signOut()
    }
    check() // a session restored from storage may already be expired
    const poll = setInterval(check, CHECK_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', check)
    }
  }, [expiresAt])
}
