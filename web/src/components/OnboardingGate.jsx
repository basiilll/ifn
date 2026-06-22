import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import Logo from './Logo'
import Spinner from './Spinner'

// Wraps the app shell: a logged-in user who has not finished onboarding is sent to
// /onboarding before they can use anything. Waits for the profile row to load first.
export default function OnboardingGate({ children }) {
  const { profile, profileLoaded } = useAuth()

  // spin only while the fetch is in flight. Once it has resolved, a missing row
  // (profile === null) means onboarding has not happened yet — send them there,
  // do not spin forever.
  if (!profileLoaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-page">
        <div className="flex flex-col items-center gap-4">
          <Logo className="h-10 w-auto" />
          <Spinner size={24} />
        </div>
      </div>
    )
  }
  if (!profile || !profile.onboarded) return <Navigate to="/onboarding" replace />
  return children
}
