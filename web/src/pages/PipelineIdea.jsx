import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Paperclip, Download, Send, CheckCircle2, Circle, CalendarClock, Pencil, Trash2, FileDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { DossierSkeleton } from '../components/PipelineSkeleton'
import ConfirmModal from '../components/ConfirmModal'
import { ApplicationModal } from './Pipeline'
import { timeAgo } from '../lib/format'
import { googleCalUrl, downloadICS, actionEvent } from '../lib/calendar'
import { errMessage } from '../lib/errors'
import { GATES, gateLabel, waitingChip, STATES, RUBRIC, LEVELS, ifnTag, currentTask, JUST_UNLOCKED, stepDotClass } from '../lib/pipeline'

const GENERIC_ERR = 'Something went wrong. Please try again.'

// The dossier: an application's complete pipeline story on one page. Serves all three roles;
// student/mentor/admin sections render conditionally off idea_dossier().
export default function PipelineIdea() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editOpen, setEditOpen] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const { data, error: e } = await supabase.rpc('idea_dossier', { p_idea: id })
    if (e) { console.error(e); setError('Could not load this idea. Check your connection and retry.'); setLoading(false); return }
    setD(data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <DossierSkeleton />
  if (error || !d?.idea) {
    return (
      <div className="card max-w-2xl p-6 text-center">
        <p className="text-sm text-muted">{error || 'This application does not exist or you cannot view it.'}</p>
        <button className="btn-outline mt-3" onClick={() => navigate('/pipeline')}>Back to pipeline</button>
      </div>
    )
  }

  const idea = d.idea
  const mine = idea.is_mine
  const mentorView = idea.is_mentor || isAdmin
  const w = waitingChip(idea.waiting_on)
  const st = STATES[idea.pipeline_state]
  const canEdit = mine && (idea.pipeline_state === 'refine' || (idea.pipeline_state === 'active' && idea.gate === 1))
  const lastRejection = [...(d.transitions || [])].reverse().find((t) => t.to_state === 'rejected' || t.to_state === 'refine')

  return (
    <div className="max-w-2xl">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back
      </button>

      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-line px-2.5 py-0.5 text-xs font-bold text-muted">{ifnTag(idea.ifn)}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {canEdit && (
            <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1 text-xs font-semibold text-muted hover:bg-black/5 hover:text-ink">
              <Pencil size={12} /> Edit application
            </button>
          )}
          <button onClick={() => exportDossier(d)} title="Download the full record as a document" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1 text-xs font-semibold text-muted hover:bg-black/5 hover:text-ink">
            <FileDown size={12} /> Export
          </button>
        </span>
      </div>
      <h1 className="mt-2 break-words text-2xl font-extrabold leading-tight">{idea.title}</h1>
      <div className="mt-1 text-sm text-muted">
        by <span className="font-semibold text-ink">{idea.author_name}</span>
        {idea.startup && <> · {idea.startup}</>}
        {idea.mentor_name && <> · Mentor: <span className="font-semibold text-ink">{idea.mentor_name}</span></>}
      </div>

      {/* one status line resolves gate + task + whose-move + state (no chip arithmetic) */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">Stage {Math.min(idea.gate, 6)} of 6 · {currentTask(idea)}</span>
        {idea.pipeline_state === 'active' && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${w.tone}`}>{w.label}</span>
        )}
        {idea.pipeline_state !== 'active' && st && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        )}
      </div>

      {/* the application: identical Q&A on every dossier (kept for the mentor's 60-second read).
          Collapsed for the founder past G3 so each later stage doesn't read like the first. */}
      <details open={idea.gate <= 3 || mentorView} className="card mt-4 p-4">
        <summary className="cursor-pointer text-sm font-bold text-ink">Application</summary>
        <div className="mt-3">
          {((idea.sectors?.length || idea.sector) || idea.oneliner) && (
            <div className="flex flex-wrap items-center gap-2">
              {idea.oneliner && <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink">{idea.oneliner}</p>}
              {(idea.sectors?.length ? idea.sectors : (idea.sector ? [idea.sector] : [])).map((s) => (
                <span key={s} className="shrink-0 rounded-md bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">{s}</span>
              ))}
            </div>
          )}
          <QA q="Problem hypothesis" a={idea.problem} />
          <QA q="Target market segments" a={idea.application?.target_user} />
          <QA q="Proposed solution / mechanisms" a={idea.solution} />
          <QA q="Team composition and key roles" a={idea.application?.team} />
          <QA q="Experimentations / discussions held" a={idea.application?.traction} />
          <QA q="Market size estimation" a={idea.application?.market_size} />
          {/* legacy rows from earlier form versions */}
          <QA q="How do they cope today?" a={idea.application?.alternatives} />
          <QA q="Why this founder?" a={idea.application?.why_you} />
        </div>
      </details>

      <GateBar gate={idea.gate} state={idea.pipeline_state} status={idea.gate_status} />

      {/* forward handoff: name what just unlocked + the next task (the happy path was the
          least-explained transition — banners only existed for rejected/refine). */}
      {idea.pipeline_state === 'active' && idea.gate_status === 'awaiting_submission' && JUST_UNLOCKED[idea.gate] && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <span className="font-semibold">✓ {JUST_UNLOCKED[idea.gate]}</span> — next: {currentTask(idea).toLowerCase()}.
        </div>
      )}

      {/* state banners */}
      {idea.pipeline_state === 'rejected' && (
        <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2.5 text-sm text-down">
          Rejected (final){lastRejection?.reason ? <>: {lastRejection.reason}</> : '.'}
        </div>
      )}
      {idea.pipeline_state === 'refine' && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm text-accent">
          <div className="font-semibold">Sent back: refine &amp; retry{lastRejection?.reason ? ` - ${lastRejection.reason}` : ''}</div>
          <div className="mt-0.5 text-xs text-accent">Editing and resubmitting re-enters the idea at G1 to climb the gates again — your IFN number stays the same.</div>
          {mine && (
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => setEditOpen(true)} className="btn-outline px-3 py-1.5 text-xs">Edit application</button>
              <ResubmitButton ideaId={idea.id} onDone={load} />
            </div>
          )}
        </div>
      )}

      {isAdmin && <AdminControls d={d} onChanged={load} onDeleted={() => navigate('/pipeline', { replace: true })} />}

      {/* current gate work area */}
      {idea.pipeline_state === 'active' && (
        <WorkArea d={d} mine={mine} isAdmin={isAdmin} onChanged={load} />
      )}

      <ActionItems d={d} mine={mine} mentorView={mentorView} onChanged={load} />
      <Files d={d} mine={mine} onChanged={load} />
      {/* no mentor yet = nobody to message; the thread appears once one is engaged */}
      {(idea.mentor_id || (d.messages || []).length > 0) && (
        <Thread d={d} mentorView={mentorView} onChanged={load} />
      )}
      <History d={d} />

      {mine && (
        <div className="mt-8 border-t border-line pt-4">
          <WithdrawButton ideaId={idea.id} ifn={idea.ifn} onDone={() => navigate('/pipeline', { replace: true })} />
        </div>
      )}

      {editOpen && (
        <ApplicationModal
          idea={idea}
          onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); load() }}
        />
      )}
    </div>
  )
}

// The whole pipeline run as one markdown document: application, every submission and review,
// action items with outcomes, the thread, and the audited transition history.
function exportDossier(d) {
  const i = d.idea
  const ts = (x) => new Date(x).toLocaleString()
  const L = []
  L.push(`# ${ifnTag(i.ifn)} - ${i.title}`)
  L.push(`Founder: ${i.author_name} · Sectors: ${(i.sectors?.length ? i.sectors : [i.sector]).filter(Boolean).join(', ') || '-'} · Mentor: ${i.mentor_name || 'none'}`)
  L.push(`State: G${i.gate} ${gateLabel(i.gate)} · ${i.gate_status.replace(/_/g, ' ')} · ${i.pipeline_state}`)
  L.push(`Filed: ${ts(i.created_at)}`)
  L.push('', '## Application')
  L.push(`**Problem:** ${i.problem}`)
  if (i.application?.target_user) L.push(`**Target market:** ${i.application.target_user}`)
  L.push(`**Solution:** ${i.solution || '-'}`)
  if (i.application?.team) L.push(`**Team:** ${i.application.team}`)
  if (i.application?.traction) L.push(`**Experimentations held:** ${i.application.traction}`)
  if (i.application?.market_size) L.push(`**Market size:** ${i.application.market_size}`)
  if (d.submissions?.length) {
    L.push('', '## Gate submissions')
    for (const s of d.submissions) {
      L.push(`### G${s.gate} (${s.status}) - ${ts(s.created_at)}`)
      for (const [k, v] of Object.entries(s.payload || {})) {
        if (v == null || v === '' || k === 'bypass_requested') continue
        L.push(`- ${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      }
    }
  }
  if (d.reviews?.length) {
    L.push('', '## Reviews')
    for (const r of d.reviews) {
      L.push(`### G${r.gate} by ${r.reviewer_name || 'mentor'} - ${r.decision} - ${ts(r.created_at)}`)
      if (r.criteria?.clarity != null) L.push(`- Rubric: ${RUBRIC.map((c) => `${c.label} ${r.criteria[c.k]}/5`).join(', ')}`)
      if (r.feasibility?.verdict) L.push(`- Feasibility: ${r.feasibility.verdict}${r.feasibility.note ? ` (${r.feasibility.note})` : ''}`)
      L.push(`- Feedback: ${r.feedback}`)
    }
  }
  if (d.actions?.length) {
    L.push('', '## Action items')
    for (const a of d.actions) {
      L.push(`- [${a.status === 'done' ? 'x' : ' '}] ${a.label}${a.due_date ? ` (due ${a.due_date})` : ''}${a.done_note ? ` - outcome: ${a.done_note}` : ''}`)
    }
  }
  if (d.messages?.length) {
    L.push('', '## Thread')
    for (const m of d.messages) L.push(`- ${ts(m.created_at)} ${m.author_name || 'member'}${m.kind === 'meeting' ? ' [meeting]' : ''}: ${m.body}`)
  }
  if (d.transitions?.length) {
    L.push('', '## History')
    for (const t of d.transitions) {
      const move = t.from_gate == null ? 'application filed (G1)' : `G${t.from_gate ?? '-'} to G${t.to_gate ?? '-'} (${t.from_state} to ${t.to_state})`
      L.push(`- ${ts(t.created_at)} ${t.by_name || 'system'} (${t.role}): ${move}${t.reason ? ` - ${t.reason}` : ''}`)
    }
  }
  const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${ifnTag(i.ifn)}-${i.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// The founder can pull their application out entirely (deletes the whole dossier).
function WithdrawButton({ ideaId, ifn, onDone }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  async function withdraw() {
    setBusy(true)
    const { error } = await supabase.rpc('withdraw_application', { p_idea: ideaId })
    setBusy(false)
    setConfirming(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    onDone()
  }
  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-down/40 px-3.5 py-2 text-xs font-semibold text-down hover:bg-down/10 focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <Trash2 size={13} /> {busy ? 'Withdrawing...' : 'Withdraw application'}
      </button>
      {confirming && (
        <ConfirmModal
          title={`Withdraw ${ifnTag(ifn)}?`}
          message="This deletes the application, its submissions, reviews, files and thread. This cannot be undone."
          confirmLabel="Withdraw application"
          tone="danger"
          onConfirm={withdraw}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

// One question/answer block of the application (skips silently for legacy rows missing a field).
function QA({ q, a }) {
  if (!a) return null
  return (
    <>
      <div className="mt-3 text-xs font-semibold text-muted">{q}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{a}</p>
    </>
  )
}

function GateBar({ gate, state, status }) {
  const [sel, setSel] = useState(null)
  const shown = GATES.find((g) => g.g === (sel || gate))
  const gateStatus = (g) => {
    if (g.g < gate) return 'done'
    if (g.g > gate) return 'upcoming'
    if (state === 'rejected') return 'rejected'
    if (status === 'submitted') return 'in review'
    if (status === 'approved') return 'approved'
    return 'your move'
  }
  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center">
        {GATES.map((g, i) => (
          <div key={g.g} className={`flex items-center ${i > 0 ? 'flex-1' : ''}`}>
            {i > 0 && <div className={`h-0.5 flex-1 ${g.g <= gate ? 'bg-accent' : 'bg-line'}`} />}
            <button
              onClick={() => setSel(g.g === sel ? null : g.g)}
              title={g.label}
              aria-label={`Gate ${g.g}, ${g.label} — ${gateStatus(g)}`}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 ${
                g.g < gate ? 'bg-accent text-onaccent'
                : g.g === gate ? stepDotClass(status, state)
                : 'border border-line bg-card text-muted hover:border-accent'
              }`}
            >
              {g.g}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 text-sm">
        <span className="font-bold">G{shown.g} · {shown.label}.</span>{' '}
        <span className="text-muted">{shown.desc}</span>
      </div>
    </div>
  )
}

function ResubmitButton({ ideaId, onDone }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const { error } = await supabase.rpc('resubmit_idea', { p_idea: ideaId })
    setBusy(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    onDone()
  }
  return <button className="btn-primary px-3 py-1.5 text-xs" onClick={go} disabled={busy}>{busy ? 'Resubmitting...' : 'Resubmit (keeps the IFN number)'}</button>
}

// ---------------------------------------------------------------------------
// Current-gate work area: student submission form, mentor accept / rubric, or a waiting note.
function WorkArea({ d, mine, isAdmin, onChanged }) {
  const idea = d.idea
  const studentTurn = mine && idea.gate >= 3 && idea.gate <= 5 && ['awaiting_submission', 'revision_requested'].includes(idea.gate_status)
  const mentorAccept = idea.is_mentor && idea.gate === 2
  const mentorReview = (idea.is_mentor || isAdmin) && idea.gate >= 3 && idea.gate <= 5 && idea.gate_status === 'submitted'
  const lastRevision = [...(d.reviews || [])].reverse().find((r) => r.gate === idea.gate && r.decision === 'revision')

  if (mentorAccept) return <MentorAccept ideaId={idea.id} onDone={onChanged} />
  if (studentTurn) return <SubmitGateForm d={d} lastRevision={lastRevision} onDone={onChanged} />
  if (mentorReview) return <ReviewForm d={d} onDone={onChanged} />

  // nothing for the viewer to do here: say plainly whose move it is
  const note =
    idea.gate === 1 ? 'In the mentor queue. A mentor will pick this up, or an admin will assign one.'
    : idea.gate === 2 ? 'Waiting for the assigned mentor to accept.'
    : idea.gate_status === 'submitted' ? 'Submission sent. Waiting on the mentor\'s review.'
    : idea.gate_status === 'approved' ? 'In incubation. Keep working through action items and the thread.'
    : mine ? '' : 'Waiting on the founder\'s submission for this gate.'
  if (!note) return null
  return <div className="mt-4 rounded-lg bg-page px-3 py-2.5 text-sm text-muted">{note}</div>
}

function MentorAccept({ ideaId, onDone }) {
  const [busy, setBusy] = useState(false)
  async function accept() {
    setBusy(true)
    const { error } = await supabase.rpc('mentor_accept', { p_idea: ideaId })
    setBusy(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    onDone()
  }
  return (
    <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">You were assigned as mentor</div>
        <div className="text-xs text-muted">Accepting moves the application to G3 and asks the founder for the full dossier.</div>
      </div>
      <button className="btn-primary" onClick={accept} disabled={busy}>{busy ? 'Accepting...' : 'Accept assignment'}</button>
    </div>
  )
}

// Student: the current gate's structured submission (server re-validates everything).
function SubmitGateForm({ d, lastRevision, onDone }) {
  const idea = d.idea
  const gate = idea.gate
  const prev = [...(d.submissions || [])].reverse().find((s) => s.gate === gate)?.payload || {}
  const [f, setF] = useState({
    who_you_are: prev.who_you_are || '', contact: prev.contact || '',
    market_value: prev.market_value || '', market_size: prev.market_size || '',
    technical: prev.feasibility_self?.technical || 'Medium',
    financial: prev.feasibility_self?.financial || 'Medium',
    market: prev.feasibility_self?.market || 'Medium',
    beta_plan: prev.beta_plan || '', milestones: prev.milestones || '',
    prototype_url: prev.prototype_url || '', demo_url: prev.demo_url || '',
    users_count: prev.users_count || '', interviews_count: prev.interviews_count || '',
    learnings: prev.learnings || '',
    bypass_requested: !!prev.bypass_requested, bypass_reason: prev.bypass_reason || '',
    iiec_funds_requested: !!prev.iiec_funds_requested, iiec_reason: prev.iiec_reason || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit() {
    let payload
    if (gate === 3) {
      if (!f.who_you_are.trim() || !f.contact.trim() || !f.market_value.trim() || !f.market_size.trim())
        return setError('All G3 fields are required.')
      payload = {
        who_you_are: f.who_you_are.trim(), contact: f.contact.trim(),
        market_value: f.market_value.trim(), market_size: f.market_size.trim(),
        feasibility_self: { technical: f.technical, financial: f.financial, market: f.market },
      }
    } else if (gate === 4) {
      if (!f.beta_plan.trim()) return setError('A beta plan is required.')
      payload = { beta_plan: f.beta_plan.trim(), milestones: f.milestones.trim() }
    } else {
      if (f.bypass_requested && !f.bypass_reason.trim()) return setError('Explain why the prototype cannot be built yet.')
      if (f.iiec_funds_requested && !f.iiec_reason.trim()) return setError('Add a reason for the IIEC funding request.')
      payload = {
        prototype_url: f.prototype_url.trim(), demo_url: f.demo_url.trim(),
        users_count: f.users_count, interviews_count: f.interviews_count, learnings: f.learnings.trim(),
        bypass_requested: f.bypass_requested, bypass_reason: f.bypass_reason.trim(),
        iiec_funds_requested: f.iiec_funds_requested, iiec_reason: f.iiec_reason.trim(),
      }
    }
    setBusy(true)
    setError('')
    const { error: e } = await supabase.rpc('submit_gate', { p_idea: idea.id, p_payload: payload })
    setBusy(false)
    if (e) { console.error(e); return setError(e.message?.includes('evidence') ? 'Evidence required: add a prototype/demo link or upload a file below first.' : errMessage(e, GENERIC_ERR)) }
    onDone()
  }

  return (
    <div className="card mt-4 p-4">
      <div className="text-sm font-bold">
        {idea.gate_status === 'revision_requested' ? 'Revision requested · resubmit ' : 'Your move: submit '}
        G{gate} ({gateLabel(gate)})
      </div>
      {lastRevision && (
        <div className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
          <span className="font-bold">Mentor feedback:</span> {lastRevision.feedback}
        </div>
      )}
      {error && <div role="alert" className="mt-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {gate === 3 && (
          <>
            <div className="sm:col-span-2"><F label="Who you are (team, background)"><textarea className="input min-h-[60px] resize-y" maxLength={1000} value={f.who_you_are} onChange={set('who_you_are')} /></F></div>
            <F label="Contact (phone / email for your mentor)"><input className="input" maxLength={120} value={f.contact} onChange={set('contact')} /></F>
            <F label="Market value (what is it worth?)"><input className="input" maxLength={200} value={f.market_value} onChange={set('market_value')} /></F>
            <F label="Market size (who and how many?)"><input className="input" maxLength={200} value={f.market_size} onChange={set('market_size')} /></F>
            <div className="sm:col-span-2 grid grid-cols-3 gap-3">
              {['technical', 'financial', 'market'].map((k) => (
                <F key={k} label={`${k[0].toUpperCase() + k.slice(1)} feasibility`}>
                  <select className="input" value={f[k]} onChange={set(k)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                </F>
              ))}
            </div>
          </>
        )}
        {gate === 4 && (
          <>
            <div className="sm:col-span-2"><F label="Beta plan (what will you build and validate?)"><textarea className="input min-h-[90px] resize-y" maxLength={3000} value={f.beta_plan} onChange={set('beta_plan')} /></F></div>
            <div className="sm:col-span-2"><F label="Milestones (one per line, optional)"><textarea className="input min-h-[60px] resize-y" maxLength={1000} value={f.milestones} onChange={set('milestones')} /></F></div>
          </>
        )}
        {gate === 5 && (
          <>
            <F label="Prototype URL"><input className="input" maxLength={300} value={f.prototype_url} onChange={set('prototype_url')} placeholder="https://..." disabled={f.bypass_requested} /></F>
            <F label="Demo / video URL (optional)"><input className="input" maxLength={300} value={f.demo_url} onChange={set('demo_url')} placeholder="https://..." disabled={f.bypass_requested} /></F>
            <F label="Users / testers so far"><input className="input" type="number" min="0" value={f.users_count} onChange={set('users_count')} /></F>
            <F label="Customer interviews done"><input className="input" type="number" min="0" value={f.interviews_count} onChange={set('interviews_count')} /></F>
            <div className="sm:col-span-2"><F label="What did you learn from real users? (optional)"><textarea className="input min-h-[80px] resize-y" maxLength={3000} value={f.learnings} onChange={set('learnings')} /></F></div>
            <p className="sm:col-span-2 text-xs text-muted">G5 advances on evidence: a prototype/demo link, or upload your demo file in Files below.</p>
            <div className="sm:col-span-2 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={f.bypass_requested}
                  onChange={(e) => setF({ ...f, bypass_requested: e.target.checked, iiec_funds_requested: e.target.checked ? false : f.iiec_funds_requested })}
                />
                <span>
                  <span className="font-semibold">Request a mentor bypass.</span>{' '}
                  The prototype needs money or resources I do not have yet. My mentor decides
                  whether to advance without a built prototype.
                </span>
              </label>
              {f.bypass_requested && (
                <textarea
                  className="input mt-2 min-h-[60px] resize-y"
                  maxLength={1000}
                  value={f.bypass_reason}
                  onChange={set('bypass_reason')}
                  placeholder="What does the prototype need (hardware, licenses, funding), what would it cost, and what have you validated without it?"
                />
              )}
            </div>
            {idea.iiec_enabled && (
              <div className="sm:col-span-2 rounded-lg border border-line p-3">
                <label className="flex items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={f.iiec_funds_requested}
                    onChange={(e) => setF({ ...f, iiec_funds_requested: e.target.checked, bypass_requested: e.target.checked ? false : f.bypass_requested })}
                  />
                  <span>
                    <span className="font-semibold">Request IIEC for funds.</span>{' '}
                    Flag this for the IFHE Innovation &amp; Entrepreneurship Council. Your mentor takes it to the IIEC.
                  </span>
                </label>
                {f.iiec_funds_requested && (
                  <textarea
                    className="input mt-2 min-h-[60px] resize-y"
                    maxLength={1000}
                    value={f.iiec_reason}
                    onChange={set('iiec_reason')}
                    placeholder="What do you need funding for, how much, and what will it unlock?"
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting...' : 'Submit for review'}</button>
      </div>
    </div>
  )
}

// Mentor review. The 7-criteria rubric + feasibility verdict appear ONLY at G3 (the formal
// idea evaluation); G4 (beta plan) and G5 (evidence) are judged by decision + feedback.
function ReviewForm({ d, onDone }) {
  const idea = d.idea
  const isG3 = idea.gate === 3
  const openActions = (d.actions || []).filter((a) => a.status === 'open').length
  const sub = [...(d.submissions || [])].reverse().find((s) => s.gate === idea.gate && s.status === 'submitted')
  const [scores, setScores] = useState(Object.fromEntries(RUBRIC.map((r) => [r.k, 3])))
  const [verdict, setVerdict] = useState('Confirmed')
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function decide(decision) {
    if (!feedback.trim()) return setError('Feedback for the founder is required.')
    setBusy(true)
    setError('')
    const { error: e } = await supabase.rpc('review_gate', {
      p_idea: idea.id,
      p_criteria: isG3 ? scores : {},
      p_feasibility: isG3 ? { verdict, note: note.trim() } : null,
      p_feedback: feedback.trim(),
      p_decision: decision,
    })
    setBusy(false)
    if (e) { console.error(e); return setError(GENERIC_ERR) }
    onDone()
  }

  return (
    <div className="card mt-4 p-4">
      <div className="text-sm font-bold">Review the G{idea.gate} submission</div>
      {sub?.payload?.bypass_requested && (
        <div className="mt-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          <span className="font-bold">Mentor bypass requested</span> - the founder says the prototype
          needs money/resources they do not have. Approving this review advances without built evidence.
        </div>
      )}
      {sub?.payload?.iiec_funds_requested && (
        <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warnink">
          <span className="font-bold">IIEC funding requested</span> — take this to the IFHE Innovation &amp; Entrepreneurship Council.
          {sub.payload.iiec_reason && <div className="mt-1 whitespace-pre-wrap text-warnink/90">{sub.payload.iiec_reason}</div>}
        </div>
      )}
      {sub && <Payload payload={sub.payload} className="mt-2" />}

      {isG3 && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {RUBRIC.map((r) => (
              <label key={r.k} className="flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-2">
                <span className="text-sm">{r.label}</span>
                <span className="flex items-center gap-2">
                  <input type="range" min="1" max="5" className="accent-accent focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={r.label} aria-valuetext={`${scores[r.k]} of 5`} value={scores[r.k]} onChange={(e) => setScores({ ...scores, [r.k]: Number(e.target.value) })} />
                  <span className="w-4 text-center text-sm font-bold text-accent">{scores[r.k]}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Founder's feasibility self-assessment">
              <select className="input" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
                <option>Confirmed</option>
                <option>Too optimistic</option>
                <option>Too pessimistic</option>
              </select>
            </F>
            <F label="Feasibility note (optional)"><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></F>
          </div>
        </>
      )}

      <div className="mt-3">
        <F label="Feedback to the founder (required)"><textarea className="input min-h-[70px] resize-y" maxLength={3000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></F>
      </div>
      {error && <div role="alert" className="mt-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      {openActions > 0 && (
        <div className="mt-2 rounded-lg bg-page px-3 py-2 text-xs text-muted">
          {openActions} open action {openActions === 1 ? 'item' : 'items'} below must be completed before this gate can be approved.
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-outline" onClick={() => decide('revision')} disabled={busy}>Request revision</button>
        <button className="btn-primary" onClick={() => decide('approved')} disabled={busy || openActions > 0} title={openActions > 0 ? 'Open action items must be completed first' : undefined}>
          {busy ? 'Saving...' : idea.gate === 5 ? 'Approve · move to Incubation' : `Approve · advance to G${idea.gate + 1}`}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action items: the off-app commitment tracker.
function ActionItems({ d, mine, mentorView, onChanged }) {
  const canComplete = mine || mentorView // founder, the idea's mentor, or an admin
  const actions = d.actions || []
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [details, setDetails] = useState('')
  const [due, setDue] = useState('')
  const [noteFor, setNoteFor] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!label.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('action_create', {
      p_idea: d.idea.id, p_label: label.trim(), p_details: details.trim(), p_due: due || null,
    })
    setBusy(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    setLabel(''); setDetails(''); setDue(''); setAdding(false)
    onChanged()
  }

  async function complete(id) {
    setBusy(true)
    const { error } = await supabase.rpc('action_done', { p_action: id, p_note: note.trim() || null })
    setBusy(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    setNoteFor(null); setNote('')
    onChanged()
  }

  if (actions.length === 0 && !mentorView) return null
  const overdue = (a) => a.status === 'open' && a.due_date && new Date(a.due_date) < new Date()

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">Action items</h2>
        {mentorView && d.idea.pipeline_state === 'active' && (
          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add action'}</button>
        )}
      </div>
      {adding && (
        <div className="card mb-3 grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-[1fr_auto]">
          <input className="input" maxLength={200} placeholder="What should the founder do? e.g. Interview 10 hostel students" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="input sm:w-40" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <input className="input sm:col-span-2" maxLength={500} placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          <div className="sm:col-span-2 flex justify-end">
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={create} disabled={busy || !label.trim()}>Assign</button>
          </div>
        </div>
      )}
      {actions.length === 0 ? (
        <p className="text-sm text-muted">No action items yet. Real progress happens between meetings; track it here.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {actions.map((a) => (
            <li key={a.id} className="p-3">
              <div className="flex items-start gap-2.5">
                {a.status === 'done'
                  ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                  : <Circle size={18} className="mt-0.5 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${a.status === 'done' ? 'text-muted line-through' : ''}`}>{a.label}</div>
                  {a.details && <div className="text-xs text-muted">{a.details}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span>by {a.created_by_name || 'mentor'}</span>
                    {a.due_date && (
                      <span className={`inline-flex items-center gap-1 ${overdue(a) ? 'font-bold text-down' : ''}`}>
                        <CalendarClock size={11} /> due {new Date(a.due_date).toLocaleDateString()}
                      </span>
                    )}
                    {mine && a.status === 'open' && a.due_date && (
                      <span className="inline-flex items-center gap-1.5">
                        <a
                          href={googleCalUrl(actionEvent({ ...a, ifn: d.idea.ifn, idea_title: d.idea.title }))}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-accent hover:underline"
                        >
                          Add to Google
                        </a>
                        <button
                          onClick={() => downloadICS(actionEvent({ ...a, ifn: d.idea.ifn, idea_title: d.idea.title }))}
                          className="font-semibold text-accent hover:underline"
                        >
                          .ics
                        </button>
                      </span>
                    )}
                    {a.done_note && <span className="text-muted">· outcome: {a.done_note}</span>}
                  </div>
                  {noteFor === a.id && (
                    <div className="mt-2 flex gap-2">
                      <input className="input" maxLength={500} placeholder="What happened? (evidence, link, numbers)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => complete(a.id)} disabled={busy}>Done</button>
                    </div>
                  )}
                </div>
                {canComplete && a.status === 'open' && noteFor !== a.id && (
                  <button className="btn-outline shrink-0 px-3 py-1.5 text-xs" onClick={() => { setNoteFor(a.id); setNote('') }}>Mark done</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Files: upload (author) + signed-URL downloads (author / mentor / admin).
function Files({ d, mine, onChanged }) {
  const files = d.attachments || []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${d.idea.id}/${d.idea.gate}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from('idea-files').upload(path, file)
    if (up.error) {
      console.error(up.error)
      setBusy(false)
      return setError(up.error.message?.includes('mime') || up.error.message?.includes('size')
        ? 'Only PDF / DOC / PPT up to 20MB.' : GENERIC_ERR)
    }
    const { error: e2 } = await supabase.rpc('register_attachment', {
      p_idea: d.idea.id, p_gate: d.idea.gate, p_path: path,
      p_name: file.name, p_size: file.size, p_mime: file.type,
    })
    setBusy(false)
    if (e2) { console.error(e2); return setError(GENERIC_ERR) }
    onChanged()
  }

  async function download(path) {
    const { data } = await supabase.storage.from('idea-files').createSignedUrl(path, 3600, { download: true })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (files.length === 0 && !mine) return null
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">Files</h2>
        {mine && d.idea.pipeline_state === 'active' && (
          <label className={`btn-outline cursor-pointer px-3 py-1.5 text-xs ${busy ? 'opacity-50' : ''}`}>
            <Paperclip size={13} className="mr-1 inline" /> {busy ? 'Uploading...' : 'Upload (PDF / DOC / PPT)'}
            <input type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx" onChange={upload} disabled={busy} />
          </label>
        )}
      </div>
      {error && <div role="alert" className="mb-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      {files.length === 0 ? (
        <p className="text-sm text-muted">No files yet. Pitch decks and docs land here.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2.5 p-3">
              <Paperclip size={15} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{f.file_name}</div>
                <div className="text-[11px] text-muted">G{f.gate} · {(f.size_bytes / 1048576).toFixed(1)}MB · {timeAgo(f.created_at)}</div>
              </div>
              <button className="btn-outline shrink-0 px-2.5 py-1.5 text-xs" onClick={() => download(f.bucket_path)} aria-label={`Download ${f.file_name}`}>
                <Download size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Private thread: founder <-> mentor (+ admins). Mentors can log offline meetings.
function Thread({ d, mentorView, onChanged }) {
  const msgs = d.messages || []
  const [body, setBody] = useState('')
  const [meeting, setMeeting] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send(e) {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('idea_message_send', {
      p_idea: d.idea.id, p_body: body.trim(), p_kind: meeting ? 'meeting' : 'message',
    })
    setBusy(false)
    if (error) { console.error(error); return alert(GENERIC_ERR) }
    setBody(''); setMeeting(false)
    onChanged()
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-bold">Mentor thread <span className="font-normal text-muted">(private: founder, mentor, admins)</span></h2>
      {msgs.length === 0 ? (
        <p className="text-sm text-muted">No messages yet. Questions, blockers, and meeting notes live here.</p>
      ) : (
        <ul className="space-y-2">
          {msgs.map((m) => (
            <li key={m.id} className={`card p-3 ${m.kind === 'meeting' ? 'border-accent/40' : ''}`}>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-ink">{m.author_name || 'Member'}</span>
                {m.kind === 'meeting' && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">MEETING LOG</span>}
                <span className="ml-auto">{timeAgo(m.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="mt-3">
        <textarea
          className="input min-h-[60px] resize-y"
          maxLength={4000}
          placeholder={meeting ? 'Meeting log: date, what was discussed, next steps...' : 'Write a message...'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {mentorView && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={meeting} onChange={(e) => setMeeting(e.target.checked)} /> Log as offline meeting
            </label>
          )}
          <button className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy || !body.trim()}>
            <Send size={13} /> Send
          </button>
        </div>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// History: submissions, reviews, and transitions merged chronologically. Nothing is hidden.
function History({ d }) {
  const items = [
    ...(d.submissions || []).map((s) => ({ at: s.created_at, el: <SubmissionItem s={s} /> , id: `s${s.id}` })),
    ...(d.reviews || []).map((r) => ({ at: r.created_at, el: <ReviewItem r={r} />, id: `r${r.id}` })),
    ...(d.transitions || []).map((t, i) => ({ at: t.created_at, el: <TransitionItem t={t} />, id: `t${i}` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  if (items.length === 0) return null
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-bold">History</h2>
      <ul className="card divide-y divide-line">
        {items.map((it) => <li key={it.id} className="p-3">{it.el}</li>)}
      </ul>
    </section>
  )
}

function TransitionItem({ t }) {
  const move = t.from_gate == null ? 'application filed (G1)'
    : t.from_state !== t.to_state && t.to_state !== 'active' ? `state: ${t.from_state} to ${t.to_state}`
    : t.from_state === 'refine' && t.to_state === 'active' ? 'resubmitted after refine'
    : t.from_gate === t.to_gate ? `update at G${t.from_gate}`
    : `G${t.from_gate} to G${t.to_gate}`
  const reason = t.reason && !move.includes(t.reason) ? t.reason : null
  return (
    <div className="text-xs text-muted">
      <span className="font-semibold text-ink">{t.by_name || 'System'}</span> ({t.role}) · {move}
      {reason && <> · {reason}</>} · {timeAgo(t.created_at)}
    </div>
  )
}

function SubmissionItem({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-muted">
      <button onClick={() => setOpen((v) => !v)} className="font-semibold text-ink hover:underline">
        G{s.gate} submission
      </button>
      {' '}· {s.status}{s.status === 'superseded' && ' (older revision)'} · {timeAgo(s.created_at)}
      {open && <Payload payload={s.payload} className="mt-2" />}
    </div>
  )
}

function ReviewItem({ r }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-muted">
      <button onClick={() => setOpen((v) => !v)} className="font-semibold text-ink hover:underline">
        G{r.gate} review
      </button>
      {' '}by {r.reviewer_name || 'mentor'} · {r.decision === 'approved' ? 'approved' : 'revision requested'} · {timeAgo(r.created_at)}
      {open && (
        <div className="mt-2 rounded-lg bg-page p-3">
          {r.criteria?.clarity != null && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {RUBRIC.map((c) => (
                <span key={c.k}>{c.label}: <span className="font-bold text-ink">{r.criteria?.[c.k]}</span>/5</span>
              ))}
            </div>
          )}
          {r.feasibility?.verdict && <div className="mt-1.5">Feasibility: <span className="font-semibold text-ink">{r.feasibility.verdict}</span>{r.feasibility.note && ` (${r.feasibility.note})`}</div>}
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{r.feedback}</p>
        </div>
      )}
    </div>
  )
}

// Render a submission payload as label/value rows. The bypass flag is rendered as a banner
// by the callers, so its raw keys are skipped here.
const PAYLOAD_HIDDEN = new Set(['bypass_requested', 'iiec_funds_requested', 'iiec_reason'])
function Payload({ payload, className = '' }) {
  if (!payload) return null
  const rows = Object.entries(payload).flatMap(([k, v]) => {
    if (v == null || v === '' || PAYLOAD_HIDDEN.has(k)) return []
    if (typeof v === 'object') return Object.entries(v).map(([k2, v2]) => [`${k.replace(/_/g, ' ')} · ${k2}`, String(v2)])
    return [[k.replace(/_/g, ' '), String(v)]]
  })
  return (
    <dl className={`rounded-lg bg-page p-3 text-xs ${className}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 py-0.5">
          <dt className="w-40 shrink-0 font-semibold capitalize text-muted">{k}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Admin: assign mentor / move gate / reject / delete - with mandatory, audited reasons.
function AdminControls({ d, onChanged, onDeleted }) {
  const idea = d.idea
  const [mentors, setMentors] = useState([])
  const [mentor, setMentor] = useState('')
  const [gate, setGate] = useState(idea.gate)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // 'reject' | 'delete' | null

  useEffect(() => {
    supabase.rpc('admin_mentor_load').then(({ data }) => setMentors(data || []))
  }, [])

  async function run(fn) {
    if (!reason.trim()) return setError('A reason is required for every admin action (it is audited).')
    setBusy(true)
    setError('')
    const e = await fn(reason.trim())
    setBusy(false)
    if (e) { console.error(e); return setError(errMessage(e, GENERIC_ERR)) }
    setReason('')
    onChanged()
  }

  const assign = () => run(async (r) =>
    (await supabase.rpc('admin_assign_mentor', { p_idea: idea.id, p_mentor: mentor || null, p_reason: r })).error)
  const move = () => run(async (r) =>
    (await supabase.rpc('admin_move_gate', { p_idea: idea.id, p_gate: Number(gate), p_reason: r })).error)
  const reject = (final) => {
    if (final) {
      if (!reason.trim()) return setError('A reason is required for every admin action (it is audited).')
      return setConfirm('reject')
    }
    run(async (r) => (await supabase.rpc('admin_reject_idea', { p_idea: idea.id, p_final: final, p_reason: r })).error)
  }
  async function rejectFinal() {
    setConfirm(null)
    await run(async (r) => (await supabase.rpc('admin_reject_idea', { p_idea: idea.id, p_final: true, p_reason: r })).error)
  }
  // delete bypasses run(): on success the dossier is gone, so we navigate away instead of reloading
  function deleteIdea() {
    if (!reason.trim()) return setError('A reason is required for every admin action (it is audited).')
    setConfirm('delete')
  }
  async function deleteConfirmed() {
    setConfirm(null)
    setBusy(true)
    setError('')
    const { error: e } = await supabase.rpc('admin_delete_pipeline_idea', { p_idea: idea.id, p_reason: reason.trim() })
    if (e) { setBusy(false); console.error(e); return setError(errMessage(e, GENERIC_ERR)) }
    onDeleted()
  }

  const stateLabel = idea.pipeline_state !== 'active' ? STATES[idea.pipeline_state]?.label
    : idea.gate === 2 ? 'Mentor Assigned - awaiting accept'
    : idea.gate === 3 && idea.gate_status === 'awaiting_submission' ? 'Mentor Picked Up - dossier pending'
    : `${gateLabel(idea.gate)} - ${idea.gate_status.replace(/_/g, ' ')}`

  return (
    <div className="card mt-4 border-accent/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-accent">Admin controls</span>
        <span className="text-[11px] text-muted">viewing changes nothing - state only moves via the buttons below</span>
      </div>
      {/* current state, highlighted so assignment/pickup status is obvious at a glance */}
      <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent">
        G{idea.gate} · {stateLabel}
        {idea.mentor_name && <span className="font-semibold">· Mentor: {idea.mentor_name}</span>}
      </div>
      {error && <div role="alert" className="mt-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex gap-2">
          <select className="input" value={mentor} onChange={(e) => setMentor(e.target.value)}>
            <option value="">Unassign / pick mentor...</option>
            {mentors.map((m) => (
              <option key={m.mentor_id} value={m.mentor_id}>{m.mentor_name} ({m.active_count} active)</option>
            ))}
          </select>
          <button className="btn-outline shrink-0 px-3 text-xs" onClick={assign} disabled={busy}>Assign</button>
        </div>
        <div className="flex gap-2">
          <select className="input" value={gate} onChange={(e) => setGate(e.target.value)}>
            {GATES.map((g) => <option key={g.g} value={g.g}>G{g.g} · {g.label}</option>)}
          </select>
          <button className="btn-outline shrink-0 px-3 text-xs" onClick={move} disabled={busy}>Move</button>
        </div>
        <input className="input sm:col-span-2" maxLength={300} placeholder="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {idea.pipeline_state === 'active' && (
            <>
              <button className="btn px-3 py-1.5 text-xs border border-accent/40 text-accent hover:bg-accent-soft" onClick={() => reject(false)} disabled={busy}>Refine &amp; retry</button>
              <button className="btn px-3 py-1.5 text-xs border border-down/40 text-down hover:bg-down/10" onClick={() => reject(true)} disabled={busy}>Reject (final)</button>
            </>
          )}
          <button className="btn ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-down/40 text-down hover:bg-down/10" onClick={deleteIdea} disabled={busy}>
            <Trash2 size={13} /> Delete permanently
          </button>
        </div>
      </div>
      {confirm === 'reject' && (
        <ConfirmModal
          title="Reject this application permanently?"
          message="The pipeline run ends. Your audited reason will be recorded."
          confirmLabel="Reject (final)"
          tone="danger"
          onConfirm={rejectFinal}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmModal
          title={`Delete ${ifnTag(idea.ifn)} permanently?`}
          message="This removes the application, its submissions, reviews, files and thread for everyone. This cannot be undone."
          confirmLabel="Delete permanently"
          tone="danger"
          onConfirm={deleteConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function F({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}
