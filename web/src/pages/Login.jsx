import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../lib/supabase'
import { authErrorMessage, isRateLimitError } from '../lib/authErrors'
import { CAPTCHA_SITEKEY, captchaEnabled } from '../lib/captcha'
import Logo from '../components/Logo'
import PasswordInput from '../components/PasswordInput'

// Client-side cooldown after a server 429. A UX hint only — Supabase enforces the real
// per-IP limit server-side; this just stops the user from hammering a locked endpoint and
// tells them when to retry. A reload bypasses it, but the server simply 429s again and the
// cooldown re-arms, so the experience self-heals.
const COOLDOWN_SECONDS = 30

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [captchaToken, setCaptchaToken] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const turnstileRef = useRef(null)
  const errorRef = useRef(null)
  const navigate = useNavigate()

  // Turnstile tokens are single-use: GoTrue spends the token on every signin attempt, so a
  // failed login (wrong password) leaves a stale, already-consumed token. Re-mint a fresh one
  // before the next attempt or the retry 400s even with the right password.
  function resetCaptcha() {
    if (!captchaEnabled) return
    turnstileRef.current?.reset()
    setCaptchaToken('')
  }

  // tick the cooldown down to zero, one second at a time; cleans up on unmount/retick
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading || cooldown > 0) return
    // Pre-submit guard: catch empty fields client-side so the user gets an instant,
    // field-tied error instead of a blank request and a generic server round-trip.
    if (!email.trim() || !password) {
      const missing = !email.trim() ? 'email' : 'password'
      setInvalidField(missing)
      setError('Enter your email and password.')
      document.getElementById(missing)?.focus()
      return
    }
    setInvalidField('')
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the verification below.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        ...(captchaEnabled ? { options: { captchaToken } } : {}),
      })
      if (signInError) {
        // A token is spent on every attempt; mint a fresh one for the retry.
        resetCaptcha()
        // Supabase returns a generic "Invalid login credentials" (no enumeration);
        // mapped to our own copy so the UI never renders a vendor string verbatim.
        if (isRateLimitError(signInError)) setCooldown(COOLDOWN_SECONDS)
        setError(authErrorMessage(signInError))
        // Pull focus to the alert so the failure is announced and seen near the action,
        // not stranded at the top of the form on short mobile viewports.
        requestAnimationFrame(() => errorRef.current?.focus())
        return
      }
      navigate('/', { replace: true })
    } catch {
      resetCaptcha()
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <form onSubmit={handleSubmit} noValidate className="card w-full max-w-sm p-8 animate-pop-in">
        <Logo className="mb-5 h-12 w-auto" />
        <h1 className="text-lg font-semibold">Back to the Network</h1>
        <p className="mb-5 text-sm text-muted">Sign in to continue.</p>

        <div className="mb-3.5 flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs font-medium text-muted">Email</label>
          <input
            id="email" type="email" maxLength={254} className="input" value={email}
            autoComplete="email"
            aria-invalid={invalidField === 'email' || undefined}
            aria-describedby={error ? 'login-error' : undefined}
            onChange={(e) => { setEmail(e.target.value); if (invalidField === 'email') setInvalidField('') }}
          />
        </div>

        <div className="mb-2 flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs font-medium text-muted">Password</label>
          <PasswordInput
            id="password" value={password}
            autoComplete="current-password"
            ariaInvalid={invalidField === 'password' || undefined}
            ariaDescribedby={error ? 'login-error' : undefined}
            onChange={(e) => { setPassword(e.target.value); if (invalidField === 'password') setInvalidField('') }}
          />
        </div>

        <div className="mb-4 text-right">
          <Link to="/forgot-password" className="inline-block -my-1 py-1 text-sm font-semibold text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        {captchaEnabled && (
          <div className="mb-4 flex justify-center">
            <Turnstile
              ref={turnstileRef}
              siteKey={CAPTCHA_SITEKEY}
              onSuccess={setCaptchaToken}
              onExpire={() => setCaptchaToken('')}
              onError={() => setCaptchaToken('')}
              options={{ theme: 'dark', size: 'flexible' }}
            />
          </div>
        )}

        {error && (
          <div
            ref={errorRef}
            id="login-error"
            role="alert"
            tabIndex={-1}
            className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={loading || cooldown > 0} className="btn-primary w-full">
          {cooldown > 0 ? `Try again in ${cooldown}s` : loading ? 'Signing in...' : 'Log in'}
        </button>

        <p className="mt-4 text-center text-sm text-muted">
          Accounts are created by an admin. Contact the IFN team to be added.
        </p>
      </form>
    </main>
  )
}
