import { useState } from 'react'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/errors'
import Logo from './Logo'
import Spinner from './Spinner'

// Blocks the whole app until a user created with a temporary password (must_change_password)
// picks their own. The temp password is single-use in practice: nothing else renders until
// this is done. Sits outside OnboardingGate so the password change happens first.
export default function PasswordChangeGate({ children }) {
  const { profile, profileLoaded, refreshProfile } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // spin only while the fetch is in flight, never on a genuinely missing row.
  if (!profileLoaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-page">
        <div className="flex flex-col items-center gap-4"><Logo className="h-10 w-auto" /><Spinner size={24} /></div>
      </div>
    )
  }
  // no profile row yet: nothing to force here — let OnboardingGate send them to /onboarding.
  if (!profile) return children
  if (!profile.must_change_password) return children

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (pw.length < 8) return setError('Password must be at least 8 characters.')
    if (pw !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    const { error: upErr } = await supabase.auth.updateUser({ password: pw })
    if (upErr) { setBusy(false); return setError(errMessage(upErr, 'Could not update your password. Try again.')) }
    const { error: flagErr } = await supabase.rpc('set_password_changed')
    if (flagErr) { setBusy(false); return setError(errMessage(flagErr, 'Password changed, but something went wrong. Refresh and try again.')) }
    await refreshProfile() // must_change_password is now false -> the gate falls through to children
    setBusy(false)
  }

  return (
    <main className="grid min-h-screen place-items-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo className="h-10 w-auto" /></div>
        <div className="card p-6">
          <h1 className="text-lg font-bold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted">You signed in with a temporary password. Choose your own to continue.</p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            {error && <div role="alert" className="rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">New password</label>
              <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Confirm password</label>
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !pw || !confirm} className="btn-primary w-full">{busy ? 'Saving...' : 'Set password & continue'}</button>
          </form>
        </div>
      </div>
    </main>
  )
}
