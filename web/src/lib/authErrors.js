// Maps Supabase GoTrue error messages to our own user-facing copy. The UI must never
// render a vendor string verbatim: the wording changes between GoTrue versions and we
// plan to move off Supabase, so coupling copy to it is fragile. Unknown errors fall back
// to a generic line.
//
// Enumeration note: by product decision we DO reveal "a user with that email already
// exists" on register (see EXISTING_EMAIL_MESSAGE and Register.jsx). This trades the
// anti-enumeration resistance of finding S6 for a clearer signup message. Login stays
// non-enumerating ("Incorrect email or password" reads the same whether the account is
// missing or the password is wrong).
export const EXISTING_EMAIL_MESSAGE = 'A user with that email already exists. Log in instead.'

export function authErrorMessage(error) {
  const raw = (error?.message || '').toLowerCase()

  if (raw.includes('invalid login credentials')) return 'Incorrect email or password.'
  if (raw.includes('email not confirmed'))
    return 'Please confirm your email first — open the link we sent you, then log in.'
  // confirmations-off path: GoTrue returns this as a real error instead of obfuscating.
  if (raw.includes('already registered') || raw.includes('already exists'))
    return EXISTING_EMAIL_MESSAGE
  if (raw.includes('rate limit') || raw.includes('too many'))
    return 'Too many attempts. Wait a moment, then try again.'
  if (raw.includes('password')) return 'Password must be at least 8 characters.'

  return 'Something went wrong. Please try again.'
}

// True when GoTrue rejected the request for exceeding a rate limit (HTTP 429). Checked
// across status, the typed `code` (e.g. over_request_rate_limit), and the message string
// because which one is populated varies by GoTrue version. Drives the cooldown UX.
export function isRateLimitError(error) {
  if (!error) return false
  if (error.status === 429) return true
  const code = (error.code || '').toLowerCase()
  if (code.includes('rate_limit')) return true
  const raw = (error.message || '').toLowerCase()
  return raw.includes('rate limit') || raw.includes('too many')
}
