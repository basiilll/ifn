import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import Logo from '../components/Logo'

export default function ResetPassword() {
  const { session, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        // Supabase rejects reusing the current password; surface the copy's promise as a friendly line.
        const samePassword =
          updateError.code === 'same_password' ||
          /should be different from the old password/i.test(updateError.message || '')
        setError(
          samePassword
            ? 'Choose a password you have not used here before.'
            : updateError.message,
        )
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // The reset link signs the user into a temporary recovery session. Wait for that to resolve.
  if (loading) return null

  // No session means they landed here without a valid reset link (or it expired).
  if (!session && !done) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="card w-full max-w-sm p-8 text-center animate-pop-in">
          <h1 className="text-lg font-semibold">Invalid or expired link</h1>
          <p className="mt-1 text-sm text-muted">
            Open the reset link from your email, or request a new one.
          </p>
          <Link to="/forgot-password" className="mt-5 inline-block text-sm font-semibold text-accent hover:underline">
            Request a new link
          </Link>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="card w-full max-w-sm p-8 text-center animate-pop-in">
          <div aria-hidden="true" className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-success/15 text-success text-xl font-bold">
            ✓
          </div>
          <h1 className="text-lg font-semibold">Password updated</h1>
          <p className="mt-1 text-sm text-muted">You can continue to the app.</p>
          <button className="btn-primary mt-5 w-full" onClick={() => navigate('/', { replace: true })}>
            Continue
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <form onSubmit={handleSubmit} noValidate className="card w-full max-w-sm p-8 animate-pop-in">
        <Logo className="mb-5 h-12 w-auto" />
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="mb-5 text-sm text-muted">Choose a password you have not used here before.</p>

        {/* Persistent live region: kept mounted so SRs reliably announce both inline and API errors. */}
        <div role="alert" aria-live="assertive">
          {error && (
            <div id="reset-error" className="mb-4 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
              {error}
            </div>
          )}
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs font-medium text-muted">New password</label>
          <div className="relative">
            <input
              id="password" type={showPassword ? 'text' : 'password'} className="input pr-14" value={password}
              placeholder="At least 8 characters" autoComplete="new-password"
              aria-invalid={!!error} aria-describedby={error ? 'reset-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 grid place-items-center rounded-r-lg px-3 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:text-accent"
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-xs font-medium text-muted">Confirm password</label>
          <div className="relative">
            <input
              id="confirm" type={showConfirm ? 'text' : 'password'} className="input pr-14" value={confirm}
              placeholder="Re-enter password" autoComplete="new-password"
              aria-invalid={!!error} aria-describedby={error ? 'reset-error' : undefined}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((s) => !s)}
              className="absolute inset-y-0 right-0 grid place-items-center rounded-r-lg px-3 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:text-accent"
              aria-pressed={showConfirm}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </main>
  )
}
