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
    // onAuthStateChange is the single source of truth. On init it emits an INITIAL_SESSION
    // event carrying the restored session AFTER the client has finished reading/refreshing it
    // from localStorage, then fires again on sign in, sign out, token refresh, and email
    // confirm. We clear `loading` on the first event (not on getSession) on purpose: a bare
    // getSession().then() could resolve null a tick before the stored session was ready, which
    // flipped loading=false with session=null and bounced every hard refresh of a deep route to
    // /login and then home. Reading the session off this event removes that race.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setLoading(false)
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
    // No uid: either auth is still settling (loading) or the user is genuinely logged out.
    // Only claim profileLoaded once auth has settled — otherwise the gate would see a
    // stale profileLoaded=true with profile=null during session restore and bounce a deep
    // link to /onboarding (then back to /), dropping the destination.
    if (!uid) { setProfile(null); setProfileLoaded(!loading); return }
    setProfileLoaded(false)
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => {
      if (active) { setProfile(data || null); setProfileLoaded(true) }
    })
    return () => { active = false }
  }, [uid, loading])

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
