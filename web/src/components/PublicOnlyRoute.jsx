import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

// Inverse of ProtectedRoute: if already signed in, do not show auth pages; send to home.
// Note: /reset-password is intentionally NOT wrapped, since the reset link creates a
// (recovery) session and the user still needs to set a new password there.
export default function PublicOnlyRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return children
}
