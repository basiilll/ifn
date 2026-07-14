import { useEffect } from 'react'

// Autosave an in-progress form to localStorage, so losing the session never costs someone their
// typing. This matters more than it used to: SESSIONS_TIMEBOX=20m signs everyone out 20 minutes
// after login whether they are mid-sentence or not (see useSessionExpiry), so any unsaved buffer
// is on a 20-minute fuse. It also covers the ordinary cases: closed tab, crash, accidental reload.
//
// Extracted from the pattern Pipeline.jsx already used ("a long form must never lose honest
// effort"). localStorage, not the server: it must survive a dead session, which is exactly when
// there is no valid token left to save with.
//
// Key per account, so a shared machine never shows one member another member's draft.
// Everything is try/caught: a corrupted draft starts clean, a full quota skips the write.

export function readDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null // corrupted draft: start clean
  }
}

export function clearDraft(key) {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

// Debounced so a fast typist doesn't hit localStorage on every keystroke. `value` is serialized
// for the dependency, so callers can pass a fresh object literal without re-running every render.
export function useDraft(key, value, { skip = false } = {}) {
  const json = JSON.stringify(value)
  useEffect(() => {
    if (skip || !key) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, json)
      } catch { /* storage full: skip */ }
    }, 400)
    return () => clearTimeout(t)
  }, [key, json, skip])
}
