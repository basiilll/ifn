// Client-side mirror of the GoTrue password floor (selfhost/.env: PASSWORD_MIN_LENGTH +
// PASSWORD_REQUIRED_CHARACTERS). GoTrue is authoritative — it rejects a weak password even if
// this check is bypassed — so this exists to surface the rule *before* submit instead of
// letting the user eat an opaque 422. Keep CLASSES in lockstep with PASSWORD_REQUIRED_CHARACTERS.
//
// Not enforced here (GoTrue has no such feature; would need custom work — audit Case III):
// password-reuse history, and blocking contextual strings like the user's own email.
export const PASSWORD_MIN_LENGTH = 8

// Plain-English statement of the same rule, for when the server rejects a password and we only
// know that it was too weak, not which class was missing (see errMessage in errors.js).
export const PASSWORD_RULE =
  'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character.'

const CLASSES = [
  [/[a-z]/, 'a lowercase letter'],
  [/[A-Z]/, 'an uppercase letter'],
  [/[0-9]/, 'a number'],
  [/[!@#%^&*()_+\-=?]/, 'a special character (!@#%^&*()_+-=?)'],
]

// Returns '' when the password passes, else a message ready for setError().
export function passwordError(pw) {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  const missing = CLASSES.filter(([re]) => !re.test(pw)).map(([, label]) => label)
  if (missing.length > 0) return `Add ${missing.join(', ')}.`
  return ''
}
