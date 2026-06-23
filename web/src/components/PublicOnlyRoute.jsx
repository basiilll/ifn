import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

// Inverse of ProtectedRoute: if already signed in, do not show auth pages. Return to the
// location ProtectedRoute bounced from (state.from) so a deep link survives the round-trip;
// fall back to the feed when there is no saved destination.
// Note: /reset-password is intentionally NOT wrapped, since the reset link creates a
// (recovery) session and the user still needs to set a new password there.
export default function PublicOnlyRoute({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (session) {
    const from = location.state?.from
    const dest = from ? `${from.pathname}${from.search || ''}` : '/'
    return <Navigate to={dest} replace />
  }
  return children
}
