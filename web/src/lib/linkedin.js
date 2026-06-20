// LinkedIn is stored as a bare handle (the part after /in/) and ALWAYS rendered as
// https://www.linkedin.com/in/<handle>. Storing a full user-supplied URL would let someone
// point the directory link at a phishing page, or at a javascript:/data: URL that React would
// execute on click (stored XSS). We never trust an arbitrary URL — only a validated handle.

// LinkedIn vanity handles: ASCII letters/digits/hyphens, 3-100 chars, not starting/ending with
// a hyphen. (Localized unicode handles exist but are rare; we trade them for safety.)
const HANDLE_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{1,98}[a-zA-Z0-9])?$/

// Accept either a full LinkedIn URL or a bare handle; return the clean handle, or '' if it is
// not a valid LinkedIn handle. Use on save to normalize whatever the user typed/pasted.
export function linkedinHandle(input) {
  if (!input) return ''
  let s = String(input).trim()
  if (!s) return ''
  const m = s.match(/linkedin\.com\/in\/([^/?#\s]+)/i) // pull <handle> out of a pasted URL
  if (m) s = m[1]
  s = s.replace(/^@+/, '').replace(/\/+$/, '').trim()
  try { s = decodeURIComponent(s) } catch { /* keep s */ }
  return HANDLE_RE.test(s) ? s : ''
}

// Canonical profile URL from a stored value (handle OR a legacy full URL). '' if none/invalid.
export function linkedinUrl(value) {
  const h = linkedinHandle(value)
  return h ? `https://www.linkedin.com/in/${h}` : ''
}
