import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { REGIONS, SECTORS, DOMAINS } from '../lib/options'
import { errMessage } from '../lib/errors'
import { linkedinHandle, linkedinUrl } from '../lib/linkedin'
import MemberTypeBadge from '../components/MemberTypeBadge'
import ProfileSkeleton from '../components/ProfileSkeleton'
import Combobox from '../components/Combobox'

export default function Profile() {
  const { session } = useAuth()
  const email = session?.user?.email
  const userId = session?.user?.id

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const errorRef = useRef(null)

  // Surface validation/save errors that may sit above the fold on a long edit form.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  useEffect(() => {
    if (!userId) return
    let active = true
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
      .then(({ data, error: e }) => {
        if (!active) return
        if (e) setError(errMessage(e, 'Could not load your profile. Refresh and try again.'))
        else setProfile(data)
        setLoading(false)
      })
    return () => { active = false }
  }, [userId])

  function startEdit() {
    setForm({
      name: profile.name || '',
      phone: profile.phone || '',
      bio: profile.bio || '',
      startup: profile.startup || '',
      region: profile.region || '',
      sector: profile.sector || '',
      domain: profile.domain || '',
      linkedin: profile.linkedin || '',
      incubation_interest: !!profile.incubation_interest,
    })
    setError('')
    setMsg('')
    setEditing(true)
  }

  async function save() {
    setError('')
    setMsg('')
    const name = form.name.trim()
    const phone = form.phone.trim()
    const linkedin = linkedinHandle(form.linkedin)
    const startup = form.startup.trim()
    const bio = form.bio.trim()
    if (!name) return setError('Name is required.')
    if (name.length > 80) return setError('Name must be 80 characters or fewer.')
    if (phone && !/^[+\d][\d\s().-]{5,19}$/.test(phone)) return setError('Enter a valid phone number.')
    if (form.linkedin.trim() && !linkedin) return setError('Enter a valid LinkedIn URL or handle (the part after /in/).')
    if (startup.length > 80) return setError('Startup must be 80 characters or fewer.')
    if (bio.length > 160) return setError('About must be 160 characters or fewer.')
    setSaving(true)
    try {
      const updates = {
        name,
        phone: phone || null,
        bio: bio || null,
        startup: startup || null,
        linkedin: linkedin || null,
        region: form.region || null,
        sector: form.sector || null,
        domain: form.domain || null,
        incubation_interest: form.incubation_interest,
      }
      // RLS allows updating own row; the role column update is revoked, so it cannot change here.
      const { data, error: e } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single()
      if (e) {
        setError(errMessage(e, 'Could not save your profile. Check your connection and try again.'))
        return
      }
      setProfile(data)
      setEditing(false)
      setMsg('Profile updated.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loading ? (
        <ProfileSkeleton />
      ) : !profile ? (
          <p className="text-sm text-down">{error || 'Profile not found.'}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            {/* identity */}
            <div className="card flex flex-col items-center p-5 text-center">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-accent-soft text-2xl font-bold text-accent">
                {(profile.name || '?').charAt(0).toUpperCase()}
              </div>
              <h2 className="mt-3 w-full break-words text-lg font-bold">{profile.name || 'Unnamed'}</h2>
              <div className="mt-1"><MemberTypeBadge type={profile.member_type} /></div>
              {profile.startup && <p className="mt-1 w-full break-words text-sm font-semibold text-muted">{profile.startup}</p>}
              {linkedinUrl(profile.linkedin) ? (
                <a href={linkedinUrl(profile.linkedin)} target="_blank" rel="noopener noreferrer" className="btn-outline mt-4 w-full">
                  Connect on LinkedIn
                </a>
              ) : (
                <button className="btn-outline mt-4 w-full opacity-60" disabled>No LinkedIn linked</button>
              )}
            </div>

            {/* details */}
            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-base font-semibold text-ink">Basic info</h3>
                {!editing && (
                  <button className="btn-outline min-h-9 px-3 py-1.5 text-xs" onClick={startEdit}>Edit profile</button>
                )}
              </div>

              {msg && (
                <div role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{msg}</div>
              )}
              {error && (
                <div ref={errorRef} role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>
              )}

              {!editing ? (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label="Full name" value={profile.name} />
                  <Field label="Email (locked)" value={email} />
                  <Field label="Phone" value={profile.phone} />
                  <Field label="Region" value={profile.region} />
                  <Field label="Sector" value={profile.sector} />
                  <Field label="Domain" value={profile.domain} />
                  <Field label="Startup" value={profile.startup} />
                  <Field label="Incubation interest" value={profile.incubation_interest ? 'Yes' : 'No'} />
                  <div className="sm:col-span-2"><Field label="About" value={profile.bio} /></div>
                </dl>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Edit label="Full name">
                    <input className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Edit>
                  <Edit label="Email (locked)">
                    <input className="input bg-page text-faint" value={email} disabled />
                  </Edit>
                  <Edit label="Phone">
                    <input className="input" maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </Edit>
                  <Edit label="Startup">
                    <input className="input" maxLength={80} value={form.startup} onChange={(e) => setForm({ ...form, startup: e.target.value })} />
                  </Edit>
                  <Edit label="Region">
                    <Combobox
                      value={form.region}
                      onChange={(v) => setForm({ ...form, region: v })}
                      options={REGIONS}
                      placeholder="Select or type a state"
                    />
                  </Edit>
                  <Edit label="Sector">
                    <Combobox value={form.sector} onChange={(v) => setForm({ ...form, sector: v })} options={SECTORS} placeholder="Search or type a sector" />
                  </Edit>
                  <Edit label="Domain">
                    <Combobox value={form.domain} onChange={(v) => setForm({ ...form, domain: v })} options={DOMAINS} placeholder="Search or type a domain" />
                  </Edit>
                  <Edit label="LinkedIn" hint="Paste your LinkedIn URL or just your handle (the part after /in/). We always link to linkedin.com.">
                    <input className="input" maxLength={200} value={form.linkedin} placeholder="your-handle or full linkedin.com/in/ URL"
                      onChange={(e) => setForm({ ...form, linkedin: e.target.value })} />
                  </Edit>
                  <div className="sm:col-span-2">
                    <Edit label={`About (${form.bio.length}/160)`}>
                      <textarea className="input min-h-[80px] resize-y" maxLength={160} value={form.bio}
                        onChange={(e) => setForm({ ...form, bio: e.target.value })} />
                    </Edit>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                    <input type="checkbox" checked={form.incubation_interest}
                      onChange={(e) => setForm({ ...form, incubation_interest: e.target.checked })} />
                    Interested in incubation
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button className="btn-primary" onClick={save} disabled={saving}>
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                    <button className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </>
  )
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value || 'Not set'}</dd>
    </div>
  )
}

function Edit({ label, hint, children }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
      {cloneElement(children, { id })}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  )
}
