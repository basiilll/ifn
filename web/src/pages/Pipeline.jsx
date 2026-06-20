import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Workflow, Plus, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ModalShell from '../components/ModalShell'
import MultiSelect from '../components/MultiSelect'
import { useAuth } from '../lib/AuthProvider'
import { PipelineListSkeleton } from '../components/PipelineSkeleton'
import { timeAgo } from '../lib/format'
import { errMessage } from '../lib/errors'
import { SECTORS } from '../lib/options'
import { GATES, gateLabel, waitingChip, STATES, ifnTag } from '../lib/pipeline'

const GENERIC_ERR = 'Something went wrong. Please try again.'

// Student home for the Idea Pipeline: my applications + their gates, and the entry point
// (a standalone application form - independent from feed posts).
export default function Pipeline() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [r, s] = await Promise.all([
      supabase.rpc('my_pipeline'),
      supabase.from('app_settings').select('pipeline_locked').single(),
    ])
    if (r.error) { console.error(r.error); setError(GENERIC_ERR) }
    else {
      setRows(r.data || [])
      setLocked(!!s.data?.pipeline_locked)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold">Idea Pipeline</h1>
          <p className="mt-0.5 text-sm text-muted">From idea to incubation: G1 to G6, with a mentor.</p>
        </div>
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          onClick={() => setFormOpen(true)}
          disabled={locked}
          title={locked ? 'Submissions are closed right now.' : undefined}
          aria-describedby={locked ? 'pipeline-locked-note' : undefined}
        >
          <Plus size={16} aria-hidden="true" /> Apply
        </button>
      </div>

      {locked && (
        <div id="pipeline-locked-note" className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-muted">
          <Lock size={15} aria-hidden="true" /> Submissions are closed right now. Existing applications keep moving.
        </div>
      )}
      {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

      {/* how it works */}
      <div className="card mt-4 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-muted">How it works</div>
        <ol className="mt-2 grid gap-1.5 text-sm text-ink sm:grid-cols-2">
          {GATES.map((g) => (
            <li key={g.g} className="flex gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{g.g}</span>
              <span><span className="font-semibold">{g.label}.</span> <span className="text-muted">{g.desc}</span></span>
            </li>
          ))}
        </ol>
      </div>

      {loading ? (
        <PipelineListSkeleton />
      ) : rows.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <Workflow size={28} aria-hidden="true" className="mx-auto text-faint" />
          <p className="mt-2 font-semibold">No applications yet.</p>
          <p className="mt-1 text-sm text-muted">File an application and a mentor will pick it up from the queue.</p>
          <button
            className="btn-primary mt-4"
            onClick={() => setFormOpen(true)}
            disabled={locked}
            title={locked ? 'Submissions are closed right now.' : undefined}
            aria-describedby={locked ? 'pipeline-locked-note' : undefined}
          >
            Apply now
          </button>
        </div>
      ) : (
        <section aria-labelledby="pipeline-apps-heading" className="card mt-4 divide-y divide-line">
          <h2 id="pipeline-apps-heading" className="sr-only">Your applications</h2>
          {rows.map((r) => {
            const w = waitingChip(r.waiting_on)
            const st = STATES[r.pipeline_state]
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/pipeline/${r.id}`)}
                className="block w-full p-4 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-muted">{ifnTag(r.ifn)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</span>
                  {r.pipeline_state !== 'active' && st && (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
                  )}
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${w.tone}`}>{w.label}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-ink">G{r.gate} · {gateLabel(r.gate)}</span>
                  {r.mentor_name && <span>· Mentor: {r.mentor_name}</span>}
                  <span>· in this gate {timeAgo(r.entered_gate_at)}</span>
                </div>
              </button>
            )
          })}
        </section>
      )}

      {formOpen && (
        <ApplicationModal
          onClose={() => setFormOpen(false)}
          onDone={(id) => { setFormOpen(false); navigate(`/pipeline/${id}`) }}
        />
      )}
    </div>
  )
}

// The G1 application form. Structured for zero ambiguity: every field asks one concrete
// question with a real example as the placeholder. Required = non-empty; long answers are
// capped at 500 chars (clarity over volume). Draft autosaves per account.
const EMPTY_APP = {
  title: '', sectors: [], market_size: '', problem: '', target_user: '',
  solution: '', team: '', traction: '',
}

export function ApplicationModal({ idea, onClose, onDone }) {
  const editing = !!idea
  const { session } = useAuth()
  const draftKey = `ifn-pipeline-draft2-${session?.user?.id || 'anon'}`

  const [f, setF] = useState(() => {
    if (editing) {
      return {
        title: idea.title || '',
        sectors: idea.sectors?.length ? idea.sectors : (idea.sector ? [idea.sector] : []),
        problem: idea.problem || '',
        solution: idea.solution || '',
        market_size: idea.application?.market_size || '',
        target_user: idea.application?.target_user || '',
        team: idea.application?.team || '',
        traction: idea.application?.traction || '',
      }
    }
    // a long form must never lose honest effort: restore this account's draft
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (saved) return { ...EMPTY_APP, ...saved }
    } catch { /* corrupted draft: start clean */ }
    return EMPTY_APP
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  // autosave new-application drafts (per account, not when editing an existing one)
  useEffect(() => {
    if (editing) return
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(f)) } catch { /* storage full: skip */ }
    }, 400)
    return () => clearTimeout(t)
  }, [f, editing, draftKey])

  const valid = f.title.trim() && f.sectors.length > 0 && f.problem.trim() && f.target_user.trim()
    && f.solution.trim() && f.team.trim()

  async function submit() {
    if (!valid) return setError('Complete every field marked *.')
    setBusy(true)
    setError('')
    const params = {
      p_title: f.title.trim(),
      p_sectors: f.sectors,
      p_problem: f.problem.trim(),
      p_solution: f.solution.trim(),
      p_application: {
        target_user: f.target_user.trim(),
        team: f.team.trim(),
        traction: f.traction.trim() || null,
        market_size: f.market_size.trim() || null,
      },
    }
    const { data, error: e } = editing
      ? await supabase.rpc('update_pipeline_idea', { p_idea: idea.id, ...params })
      : await supabase.rpc('pipeline_submit', params)
    setBusy(false)
    if (e) {
      console.error(e)
      return setError(errMessage(e, GENERIC_ERR))
    }
    if (!editing) { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }
    onDone(editing ? idea.id : data)
  }

  return (
    <ModalShell onRequestClose={() => !busy && onClose()} labelledBy="pipeline-apply-title" className="max-w-2xl">
      <h2 id="pipeline-apply-title" className="text-lg font-bold">{editing ? 'Edit your application' : 'Apply to the Idea Pipeline'}</h2>
        <p className="mt-1 text-sm text-muted">
          Be specific. Mentors pick the ideas they can clearly understand. Your draft autosaves on this device.
        </p>
        {error && <div role="alert" className="mt-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

        <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <AppField label="Startup / concept title *">
            <input className="input" maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. AgriSense Rust Disease Spotter" />
          </AppField>
          <AppField label="Sectors * (pick one or more)">
            <MultiSelect
              value={f.sectors}
              onChange={(v) => setF((cur) => ({ ...cur, sectors: v }))}
              options={SECTORS}
              placeholder="Select sectors..."
            />
          </AppField>

          <div className="sm:col-span-2">
            <AppField label="Detailed problem hypothesis *" counter={`${f.problem.length}/500`}>
              <textarea className="input min-h-[100px] resize-y" maxLength={500} value={f.problem} onChange={set('problem')} placeholder="Describe with clarity who has the problem and at what frequency..." />
            </AppField>
          </div>

          <AppField label="Target market segments *">
            <input className="input" maxLength={200} value={f.target_user} onChange={set('target_user')} placeholder="e.g. Marginal wheat farmers in Telangana..." />
          </AppField>
          <AppField label="Proposed solution / mechanisms *" counter={`${f.solution.length}/500`}>
            <textarea className="input min-h-[42px] resize-y" maxLength={500} value={f.solution} onChange={set('solution')} placeholder="Low power cameras with solar panels sending alerts via Twilio..." />
          </AppField>

          <AppField label="Team composition &amp; key roles *">
            <input className="input" maxLength={300} value={f.team} onChange={set('team')} placeholder="Rahul (Frontend/ML), Vicky (External sales lead)..." />
          </AppField>
          <AppField label="Experimentations / discussions held already (optional)">
            <input className="input" maxLength={300} value={f.traction} onChange={set('traction')} placeholder="Presold simulated signups to 12 rural cooperative associations..." />
          </AppField>

          <AppField label="Rough TAM estimation / market size (optional)">
            <input className="input" maxLength={120} value={f.market_size} onChange={set('market_size')} placeholder="TAM: $24B, SAM: $35M, SOM: $4M" />
          </AppField>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !valid}>
            {busy ? 'Submitting...' : editing ? 'Save changes' : 'Submit to Gate 1'}
          </button>
        </div>
    </ModalShell>
  )
}

// Mockup-style field: small bold uppercase label, optional counter on the right.
function AppField({ label, counter, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px] font-bold uppercase tracking-wide text-muted">
        <span>{label}</span>
        {counter && <span className="shrink-0 font-medium normal-case text-faint">{counter}</span>}
      </span>
      {children}
    </label>
  )
}
