import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Holds the current Supabase session for the whole app. `loading` is true until the
// initial session check resolves, so guards do not flash before we know who you are.
// Also loads the caller's own profiles row (role drives admin UI, onboarded gates the app).
const AuthContext = createContext({ session: null, loading: true, profile: null, isAdmin: false, banned: false })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    // 1. read the persisted session once on load (Supabase keeps it in localStorage)
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // 2. keep it live: fires on sign in, sign out, token refresh, and email confirm
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id
  const refreshProfile = useCallback(async () => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data || null)
  }, [uid])

  // own profile row (RLS: read own). Role/onboarded here are display/routing only;
  // the server re-checks is_admin() inside every admin RPC.
  useEffect(() => {
    let active = true
    if (!uid) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', uid).single().then(({ data }) => {
      if (active) setProfile(data || null)
    })
    return () => { active = false }
  }, [uid])

  return (
    <AuthContext.Provider
      value={{
        session, loading, profile, refreshProfile,
        isAdmin: profile?.role === 'admin',
        isMentor: profile?.role === 'mentor' || profile?.role === 'admin',
        banned: !!profile?.banned,
        restricted: !!profile?.restricted,
        onboarded: !!profile?.onboarded,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
