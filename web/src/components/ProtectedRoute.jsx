import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import Logo from './Logo'
import Spinner from './Spinner'

// Gate for authed-only routes. While the initial session check runs, show a branded
// full-page loader (not a blank screen). No session means bounce to login.
export default function ProtectedRoute({ children }) {
  const { session, loading, banned } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-page">
        <div className="flex flex-col items-center gap-4">
          <Logo className="h-10 w-auto" />
          <Spinner size={24} />
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (banned) {
    return (
      <div className="grid min-h-screen place-items-center bg-page px-6">
        <div className="max-w-sm text-center">
          <Logo className="mx-auto h-10 w-auto" />
          <h1 className="mt-6 text-lg font-bold text-ink">Your account is suspended</h1>
          <p className="mt-2 text-sm text-muted">This account has been banned by an administrator. Contact the IFN team if you think this is a mistake.</p>
          <button className="btn-outline mt-6" onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>
    )
  }
  return children
}
