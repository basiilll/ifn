import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { linkedinHandle } from '../lib/linkedin'
import { REGIONS, SECTORS, DOMAINS } from '../lib/options'
import Logo from '../components/Logo'
import Combobox from '../components/Combobox'

export default function Onboarding() {
  const navigate = useNavigate()
  const { session, profile, refreshProfile } = useAuth()
  const email = session?.user?.email

  const [form, setForm] = useState({
    name: '', startup: '', region: '', sector: '', domain: '',
    phone: '', linkedin: '', bio: '', incubation_interest: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [seeded, setSeeded] = useState(false)
  const nameRef = useRef(null)

  // seed name from the profile once it loads (then let the user edit freely)
  useEffect(() => {
    if (profile && !seeded) {
      setForm((f) => ({ ...f, name: profile.name || '' }))
      setSeeded(true)
    }
  }, [profile, seeded])

  // already onboarded -> nothing to do here
  if (profile?.onboarded) return <Navigate to="/" replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // focus the first invalid field so the single error banner is actionable
  const fail = (msg, fieldId) => {
    setError(msg)
    if (fieldId === 'name') nameRef.current?.focus()
    else if (fieldId) document.getElementById(fieldId)?.focus()
    return undefined
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const name = form.name.trim()
    const phone = form.phone.trim()
    const linkedin = linkedinHandle(form.linkedin)
    if (!name) return fail('Your name is required.', 'name')
    if (name.length > 80) return fail('Name must be 80 characters or fewer.', 'name')
    if (!form.region) return fail('Pick your region.', 'region')
    if (!form.sector) return fail('Pick your sector.', 'sector')
    if (!form.domain) return fail('Pick your domain.', 'domain')
    if (phone && !/^[+\d][\d\s().-]{5,19}$/.test(phone)) return fail('Enter a valid phone number.', 'phone')
    if (form.linkedin.trim() && !linkedin) return fail('Enter a valid LinkedIn URL or handle (the part after /in/).', 'linkedin')

    setSaving(true)
    const { error: e2 } = await supabase.from('profiles').update({
      name,
      startup: form.startup.trim() || null,
      region: form.region,
      sector: form.sector,
      domain: form.domain,
      phone: phone || null,
      linkedin: linkedin || null,
      bio: form.bio.trim() || null,
      incubation_interest: form.incubation_interest,
      onboarded: true,
    }).eq('id', session.user.id)
    if (e2) { console.error(e2); setSaving(false); return setError('Something went wrong. Please try again.') }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="flex flex-col items-center text-center">
          <Logo className="h-9 w-auto" />
          <h1 id="onboarding-heading" className="mt-5 text-2xl font-extrabold">Welcome to ICFAI Founders Network</h1>
          <p className="mt-1 text-sm text-muted">Tell us a bit about you so the right people can find you. Takes a minute.</p>
        </div>

        <form onSubmit={submit} aria-labelledby="onboarding-heading" className="card mt-6 p-6">
          {error && <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <input id="name" ref={nameRef} className="input" maxLength={80} value={form.name} onChange={set('name')} placeholder="Your name" required aria-required="true" />
            </Field>
            <Field label="Email (locked)">
              <input className="input bg-page text-faint" value={email || ''} disabled />
            </Field>
            <Field label="Region" required>
              <Combobox
                id="region"
                value={form.region}
                onChange={(v) => setForm((f) => ({ ...f, region: v }))}
                options={REGIONS}
                placeholder="Select or type a state"
              />
            </Field>
            <Field label="Sector" required>
              <Combobox id="sector" value={form.sector} onChange={(v) => setForm((f) => ({ ...f, sector: v }))} options={SECTORS} placeholder="Search or type a sector" />
            </Field>
            <Field label="Domain" required>
              <Combobox id="domain" value={form.domain} onChange={(v) => setForm((f) => ({ ...f, domain: v }))} options={DOMAINS} placeholder="Search or type a domain" />
            </Field>
            <Field label="Startup (optional)">
              <input className="input" maxLength={80} value={form.startup} onChange={set('startup')} placeholder="Your startup name" />
            </Field>
            <Field label="Phone (optional)">
              <input id="phone" className="input" maxLength={20} value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="LinkedIn (optional)">
              <input id="linkedin" className="input" maxLength={200} value={form.linkedin} onChange={set('linkedin')} placeholder="your-handle or full linkedin.com/in/ URL" />
              <p className="mt-1 text-xs text-faint">Paste your LinkedIn URL or just your handle (the part after /in/).</p>
            </Field>
            <div className="sm:col-span-2">
              <Field label={`About (${form.bio.length}/160)`}>
                <textarea className="input min-h-[70px] resize-y" maxLength={160} value={form.bio} onChange={set('bio')} placeholder="One line about what you are building or looking for" />
              </Field>
            </div>
            <label className="flex items-center gap-2 py-1.5 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-accent focus-visible:ring-2 focus-visible:ring-accent/50"
                checked={form.incubation_interest}
                onChange={(e) => setForm({ ...form, incubation_interest: e.target.checked })}
              />
              I am interested in incubation
            </label>
          </div>

          <button type="submit" className="btn-primary mt-6 w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Get started'}
          </button>
          <p className="mt-3 text-center text-xs text-muted">You can edit all of this later in your Profile and Settings.</p>
        </form>
      </div>
    </main>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">
        {label}
        {required && <span className="text-down" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      {children}
    </label>
  )
}
