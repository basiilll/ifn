import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Holds the current Supabase session for the whole app. `loading` is true until the
// initial session check resolves, so guards do not flash before we know who you are.
// Also loads the caller's own profiles row (role drives admin UI, onboarded gates the app).
const AuthContext = createContext({ session: null, loading: true, profile: null, profileLoaded: false, isAdmin: false, banned: false })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  // false until the profile fetch for the current uid resolves. Lets gates tell
  // "still fetching" apart from "no row exists" (the latter must not spin forever).
  const [profileLoaded, setProfileLoaded] = useState(false)

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
  // maybeSingle (not single): a user with no profiles row must come back as null data,
  // not a 406 Not Acceptable that leaves profile stuck null forever (infinite gate spinner).
  const refreshProfile = useCallback(async () => {
    if (!uid) { setProfile(null); setProfileLoaded(true); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(data || null)
    setProfileLoaded(true)
  }, [uid])

  // own profile row (RLS: read own). Role/onboarded here are display/routing only;
  // the server re-checks is_admin() inside every admin RPC.
  useEffect(() => {
    let active = true
    if (!uid) { setProfile(null); setProfileLoaded(true); return }
    setProfileLoaded(false)
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => {
      if (active) { setProfile(data || null); setProfileLoaded(true) }
    })
    return () => { active = false }
  }, [uid])

  return (
    <AuthContext.Provider
      value={{
        session, loading, profile, profileLoaded, refreshProfile,
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
