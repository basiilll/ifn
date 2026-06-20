import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import MemberTypeBadge from '../components/MemberTypeBadge'
import ConfirmModal from '../components/ConfirmModal'

const NOTIF_ROWS = [
  { key: 'pipeline', label: 'Idea Pipeline', desc: 'Gate decisions, reviews, action items, and messages on your ideas.' },
  { key: 'problems', label: 'Problem Hub', desc: 'New solutions on your problems and reviews of your solutions.' },
  { key: 'team', label: 'Team Acquisition', desc: 'Updates on applications to your role needs.' },
]

export default function Settings() {
  const { session } = useAuth()
  const email = session?.user?.email
  const userId = session?.user?.id

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listed, setListed] = useState(true)
  const [contactable, setContactable] = useState(true)
  const [notif, setNotif] = useState({ pipeline: true, problems: true, team: true })
  const [status, setStatus] = useState({}) // per-row: 'saved' | 'error'
  const [isDark, setIsDark] = useState(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  // security
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwOk, setPwOk] = useState(false)
  const [confirmGlobalOut, setConfirmGlobalOut] = useState(false)

  useEffect(() => {
    if (!userId) return
    let active = true
    supabase
      .from('profiles')
      .select('name, role, member_type, directory_visible, contactable, notification_prefs')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!active || !data) { if (active) setLoading(false); return }
        setProfile(data)
        setListed(data.directory_visible !== false)
        setContactable(data.contactable !== false)
        const p = data.notification_prefs || {}
        setNotif({ pipeline: p.pipeline !== false, problems: p.problems !== false, team: p.team !== false })
        setLoading(false)
      })
    return () => { active = false }
  }, [userId])

  // flash a transient saved/failed marker on one row
  function flash(key, state) {
    setStatus((s) => ({ ...s, [key]: state }))
    setTimeout(() => setStatus((s) => ({ ...s, [key]: undefined })), 2500)
  }

  async function saveColumn(key, column, value) {
    const { error } = await supabase.from('profiles').update({ [column]: value }).eq('id', userId)
    if (error) { console.error(error); flash(key, 'error'); return false }
    flash(key, 'saved')
    return true
  }

  async function toggleListed() {
    const next = !listed
    setListed(next)
    if (!(await saveColumn('listed', 'directory_visible', next))) setListed(!next)
  }
  async function toggleContactable() {
    const next = !contactable
    setContactable(next)
    if (!(await saveColumn('contact', 'contactable', next))) setContactable(!next)
  }
  async function toggleNotif(catKey) {
    const next = !notif[catKey]
    const updated = { ...notif, [catKey]: next }
    setNotif(updated)
    if (!(await saveColumn(catKey, 'notification_prefs', updated))) setNotif(notif)
  }

  function toggleTheme() {
    const dark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
    setIsDark(dark)
  }

  async function changePassword(e) {
    e.preventDefault()
    setPwOk(false)
    if (pw1.length < 8) return setPwError('Use at least 8 characters.')
    if (pw1 !== pw2) return setPwError('The two passwords do not match.')
    setPwBusy(true)
    setPwError('')
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    setPwBusy(false)
    if (error) { console.error(error); return setPwError(error.message || 'Could not update your password. Try again.') }
    setPw1(''); setPw2(''); setPwOk(true)
  }

  async function signOutEverywhere() {
    setConfirmGlobalOut(false)
    await supabase.auth.signOut({ scope: 'global' })
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Account */}
      <section className="card p-5">
        <h2 className="mb-3 text-base font-bold">Account</h2>
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-lg font-bold text-accent">
            {loading ? '' : (profile?.name || email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {loading ? (
              <>
                <div className="h-4 w-32 rounded bg-line" />
                <div className="mt-1.5 h-3 w-40 rounded bg-line" />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{profile?.name || 'Unnamed'}</span>
                  <MemberTypeBadge type={profile?.member_type} />
                </div>
                <div className="truncate text-sm text-muted">{email}</div>
              </>
            )}
          </div>
          <Link to="/profile" className="btn-outline ml-auto px-3 py-1.5 text-xs">Edit in Profile</Link>
        </div>
        <p className="mt-3 text-xs text-muted">
          Email and role are managed by IFN. An Admin can change a member's role.
        </p>
      </section>

      {/* Notifications */}
      <section className="card p-5">
        <h2 className="mb-1 text-base font-bold">Notifications</h2>
        <p className="mb-3 text-xs text-muted">Choose what reaches your notification bell.</p>
        <div className="space-y-4">
          {NOTIF_ROWS.map((row) => (
            <Row
              key={row.key}
              label={row.label}
              desc={row.desc}
              on={notif[row.key]}
              status={status[row.key]}
              onToggle={() => toggleNotif(row.key)}
              disabled={loading}
            />
          ))}
        </div>
      </section>

      {/* Directory / privacy */}
      <section className="card p-5">
        <h2 className="mb-3 text-base font-bold">Directory</h2>
        <div className="space-y-4">
          <Row
            label="List me in the Directory"
            desc={`Let other members find you. ${listed ? 'On' : 'Off'}`}
            on={listed}
            status={status.listed}
            onToggle={toggleListed}
            disabled={loading}
          />
          <Row
            label="Let people contact you"
            desc={`Members can send you a message through the network (your email stays private). ${contactable ? 'On' : 'Off'}`}
            on={contactable}
            status={status.contact}
            onToggle={toggleContactable}
            disabled={loading}
          />
        </div>
        {!listed && <p className="mt-3 text-xs text-muted">You are hidden from the Directory. Turn the first toggle on to appear.</p>}
      </section>

      {/* Security */}
      <section className="card p-5">
        <h2 className="mb-3 text-base font-bold">Security</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="text-sm font-semibold">Change password</div>
          {pwError && <div id="pw-error" role="alert" className="rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{pwError}</div>}
          {pwOk && (
            <div role="status" className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              <Check size={15} /> Password updated.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">New password</span>
              <input className="input" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="At least 8 characters" aria-invalid={!!pwError} aria-describedby={pwError ? 'pw-error' : undefined} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Confirm new password</span>
              <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat it" aria-invalid={!!pwError} aria-describedby={pwError ? 'pw-error' : undefined} />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={pwBusy || !pw1 || !pw2}>
              {pwBusy ? 'Updating...' : 'Update password'}
            </button>
          </div>
        </form>
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Log out (this device)</div>
              <div className="text-xs text-muted">End your session here only.</div>
            </div>
            <button className="btn-outline ml-auto shrink-0" onClick={() => supabase.auth.signOut()}>Log out</button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Sign out everywhere</div>
              <div className="text-xs text-muted">End your session on every device, including shared lab machines.</div>
            </div>
            <button className="btn-outline ml-auto shrink-0" onClick={() => setConfirmGlobalOut(true)}>Sign out everywhere</button>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="card p-5">
        <h2 className="mb-3 text-base font-bold">Appearance</h2>
        <Row
          label="Dark mode"
          desc={isDark ? 'On' : 'Off'}
          on={isDark}
          onToggle={toggleTheme}
        />
      </section>

      {confirmGlobalOut && (
        <ConfirmModal
          title="Sign out everywhere?"
          message="You will need to log in again on every device, including here."
          confirmLabel="Sign out everywhere"
          tone="danger"
          onConfirm={signOutEverywhere}
          onClose={() => setConfirmGlobalOut(false)}
        />
      )}
    </div>
  )
}

// One preference row: label + description on the left, switch on the right, with a
// transient saved/failed marker. The switch borrows its accessible name from the label.
function Row({ label, desc, on, status, onToggle, disabled }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted">{desc}</div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span aria-live="polite" className="text-xs font-semibold">
          {status === 'saved' && <span className="text-success">Saved</span>}
          {status === 'error' && <span className="text-down">Not saved</span>}
        </span>
        <Toggle on={on} onClick={onToggle} ariaLabel={label} disabled={disabled} />
      </div>
    </div>
  )
}

function Toggle({ on, onClick, ariaLabel, disabled }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-50
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card
        ${on ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
