// Turn a Supabase/Postgres error into a user-facing message.
//
// A server-side `raise exception` (our business rules: read-only, banned, posting
// closed, "title required", ...) comes back as Postgres code P0001 with a human
// message we SHOULD show. RLS rejections come back as 42501 / "row-level security".
// Anything else (network, unknown) gets the caller's generic fallback.

const FRIENDLY = {
  'your account is read-only': 'Your account is in read-only mode — posting, editing, voting and messaging are turned off. Contact an admin if this is a mistake.',
  'account is banned': 'Your account has been banned. Contact the IFN team if you think this is a mistake.',
  'posting is currently closed': 'Posting is closed by an admin right now.',
  'pipeline submissions are currently closed': 'Pipeline submissions are closed right now.',
  'this member is not reachable': 'This member has turned off messages.',
}

export function errMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback
  const raw = (err.message || '').trim()
  const key = raw.toLowerCase()
  if (FRIENDLY[key]) return FRIENDLY[key]
  // RLS-blocked writes (e.g. a read-only user editing their profile or voting) don't
  // carry our message; name the most likely cause instead of a connection error.
  if (err.code === '42501' || /row-level security/i.test(raw)) {
    return 'You do not have permission to do that. If your account is read-only, contact an admin.'
  }
  // Our own raise_exception business rules: show the message, capitalized.
  if (err.code === 'P0001' && raw) return raw.charAt(0).toUpperCase() + raw.slice(1)
  return fallback
}
