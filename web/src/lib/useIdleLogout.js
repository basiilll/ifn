import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

// NIC secure-code checklist item 20: log the user out after a period of inactivity.
// GoTrue's access token auto-refreshes, so a session is otherwise effectively permanent;
// this enforces an idle ceiling on the client. On timeout we call signOut() — AuthProvider's
// auth listener clears the session and ProtectedRoute bounces the user to /login.
const IDLE_MS = 20 * 60 * 1000 // 20 minutes of inactivity
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange']

export function useIdleLogout(enabled = true) {
  const timer = useRef(null)
  useEffect(() => {
    if (!enabled) return
    function reset() {
      // A backgrounded tab firing visibilitychange shouldn't keep the session alive.
      if (document.visibilityState === 'hidden') return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { supabase.auth.signOut() }, IDLE_MS)
    }
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset() // arm on mount
    return () => {
      clearTimeout(timer.current)
      EVENTS.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [enabled])
}
