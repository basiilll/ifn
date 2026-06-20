import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowBigUp, ArrowBigDown, CalendarClock, MessageCircle, MoreHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import AuthorLink from '../components/AuthorLink'
import { MenuItem } from '../components/Dropdown'
import ProblemModal from '../components/ProblemModal'
import { timeAgo } from '../lib/format'
import { errMessage } from '../lib/errors'

const SSORTS = [
  { s: 'top', label: 'Top' },
  { s: 'new', label: 'New' },
  { s: 'old', label: 'Old' },
]
// a reviewed solution's score = impact + feasibility (out of 20); unreviewed sink to the bottom
const sscore = (s) => (s.reviewed_at ? (Number(s.impact) || 0) + (Number(s.feasibility) || 0) : -1)
const GENERIC_ERR = 'Something went wrong. Please try again.'

// kebab "..." menu with outside-click close; children is a render fn receiving close().
function Kebab({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuRef = useRef(null)
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  // move focus into the menu on open so keyboard users land on the first item
  useEffect(() => {
    if (open) menuRef.current?.querySelector('button')?.focus()
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-full p-2 text-muted transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2"
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[160px] rounded-xl border border-line bg-card p-1 shadow-pop"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export default function ProblemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, isAdmin, isMentor } = useAuth()
  const uid = session?.user?.id

  const [problem, setProblem] = useState(null)
  const [solutions, setSolutions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [body, setBody] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [ssort, setSsort] = useState('top')
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [voteScore, setVoteScore] = useState(0)
  const [myVote, setMyVote] = useState(0)
  const [voting, setVoting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [d, s] = await Promise.all([
        supabase.rpc('problem_detail', { p_id: id }),
        supabase.rpc('problem_solutions_list', { p_problem: id }),
      ])
      if (d.error) throw d.error
      const p = d.data?.[0] || null
      setProblem(p)
      if (p) { setVoteScore(Number(p.score) || 0); setMyVote(Number(p.my_vote) || 0) }
      setSolutions(s.data || [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function vote(v) {
    if (voting) return
    const prevScore = voteScore
    const prevVote = myVote
    const nextVote = myVote === v ? 0 : v
    setMyVote(nextVote)
    setVoteScore(prevScore + (nextVote - prevVote))
    setVoting(true)
    try {
      if (nextVote === 0) {
        await supabase.from('problem_votes').delete().eq('problem_id', id).eq('user_id', uid)
      } else {
        await supabase.from('problem_votes').upsert({ problem_id: id, user_id: uid, value: nextVote })
      }
    } catch {
      setMyVote(prevVote)
      setVoteScore(prevScore)
    } finally {
      setVoting(false)
    }
  }

  async function refreshSolutions() {
    const { data } = await supabase.rpc('problem_solutions_list', { p_problem: id })
    setSolutions(data || [])
  }

  async function addSolution(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.rpc('problem_solve', { p_problem: id, p_body: text })
    setBusy(false)
    if (error) { console.error(error); return setActionError('Could not post your solution. Check your connection and try again.') }
    setActionError('')
    setBody('')
    setComposerOpen(false)
    refreshSolutions()
  }

  function startEdit(s) { setEditingId(s.id); setEditBody(s.description) }
  async function saveEdit(s) {
    if (!editBody.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('update_solution', { p_solution: s.id, p_body: editBody.trim() })
    setBusy(false)
    if (error) { console.error(error); return setActionError(errMessage(error, GENERIC_ERR)) }
    setActionError('')
    setEditingId(null)
    refreshSolutions()
  }

  async function deleteSolution(sid, mine) {
    if (!window.confirm('Delete this solution?')) return
    // own solutions delete via RLS; others (admin moderation) via the admin RPC
    const { error } = mine
      ? await supabase.from('problem_solutions').delete().eq('id', sid)
      : await supabase.rpc('admin_delete_solution', { p_id: sid })
    if (error) { console.error(error); return setActionError('Could not delete the solution. Try again.') }
    setSolutions((prev) => prev.filter((s) => s.id !== sid))
  }

  async function deleteProblem() {
    if (!window.confirm('Delete this problem? Its solutions go with it.')) return
    const { error } = problem.is_mine
      ? await supabase.from('problems').delete().eq('id', id)
      : await supabase.rpc('admin_delete_problem', { p_id: id })
    if (error) { console.error(error); return setActionError('Could not delete the problem. Try again.') }
    navigate('/problem-hub', { replace: true })
  }

  async function toggleClosed() {
    const { error } = await supabase.rpc('set_problem_closed', { p_id: id, p_closed: !problem.closed })
    if (error) { console.error(error); return setActionError('Could not update the problem. Try again.') }
    setProblem((p) => ({ ...p, closed: !p.closed }))
  }

  // one solution per member: find yours so the composer becomes an edit affordance
  const mySolution = uid ? solutions.find((s) => s.author_id === uid) : null
  // the single highest-scored reviewed solution gets the "Top solution" badge
  const topId = solutions.filter((s) => s.reviewed_at).sort((a, b) => sscore(b) - sscore(a))[0]?.id
  const sortedSolutions = [...solutions].sort((a, b) => {
    if (ssort === 'top') {
      const d = sscore(b) - sscore(a)
      return d !== 0 ? d : new Date(b.created_at) - new Date(a.created_at)
    }
    return ssort === 'new'
      ? new Date(b.created_at) - new Date(a.created_at)
      : new Date(a.created_at) - new Date(b.created_at)
  })

  return (
    <div className="max-w-2xl">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 rounded text-sm font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <ArrowLeft size={16} /> Back
      </button>

      {loading ? (
        <ProblemDetailSkeleton />
      ) : loadError ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">{GENERIC_ERR}</p>
          <button className="btn-outline mt-3" onClick={load}>Try again</button>
        </div>
      ) : !problem ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">This problem does not exist or was removed.</p>
          <button className="btn-outline mt-3" onClick={() => navigate('/problem-hub')}>Back to Problem Hub</button>
        </div>
      ) : (
        <>
          {actionError && (
            <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{actionError}</div>
          )}

          {/* problem header */}
          <div className="flex items-center gap-2">
            <AuthorLink id={problem.author_id} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">
              {(problem.author_name || '?').charAt(0).toUpperCase()}
            </AuthorLink>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <AuthorLink id={problem.author_id} className="truncate text-sm font-bold">{problem.author_name}</AuthorLink>
              </div>
              <div className="text-xs text-muted">{timeAgo(problem.created_at)}</div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {problem.closed && (
                <span className="rounded-md bg-down/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-down">Closed</span>
              )}
              {(problem.is_mine || isAdmin) && (
                <Kebab>
                  {(close) => (
                    <>
                      {problem.is_mine && (
                        <MenuItem onClick={() => { close(); setEditOpen(true) }}>Edit problem</MenuItem>
                      )}
                      <MenuItem onClick={() => { close(); toggleClosed() }}>
                        {problem.closed ? 'Reopen problem' : 'Close problem'}
                      </MenuItem>
                      <MenuItem onClick={() => { close(); deleteProblem() }}>
                        <span className="text-down">Delete problem</span>
                      </MenuItem>
                    </>
                  )}
                </Kebab>
              )}
            </div>
          </div>

          {/* title + body */}
          <h1 className="mt-3 break-words text-2xl font-extrabold leading-tight">{problem.title}</h1>
          {problem.deadline && (
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-muted">
              <CalendarClock size={15} />
              <span>Needed by {new Date(problem.deadline).toLocaleDateString()}</span>
            </div>
          )}
          <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{problem.description}</p>

          {problem.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {problem.tags.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          )}

          <div className="mt-4 inline-flex items-center gap-0.5 rounded-lg bg-page px-1 py-0.5">
            <button
              onClick={() => vote(1)}
              aria-label="Upvote"
              className={`rounded-full p-2 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${myVote === 1 ? 'text-accent' : 'text-muted'}`}
            >
              <ArrowBigUp size={20} fill={myVote === 1 ? 'currentColor' : 'none'} />
            </button>
            <span className={`min-w-[2ch] text-center text-sm font-bold ${myVote > 0 ? 'text-accent' : myVote < 0 ? 'text-down' : 'text-ink'}`}>
              {voteScore}
            </span>
            <button
              onClick={() => vote(-1)}
              aria-label="Downvote"
              className={`rounded-full p-2 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${myVote === -1 ? 'text-down' : 'text-muted'}`}
            >
              <ArrowBigDown size={20} fill={myVote === -1 ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* solutions header + sort */}
          <div className="mb-3 mt-6 flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-bold">
              <MessageCircle size={16} className="text-muted" /> {solutions.length} {solutions.length === 1 ? 'Solution' : 'Solutions'}
            </h2>
            {solutions.length > 1 && (
              <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Sort solutions">
                {SSORTS.map((o) => (
                  <button
                    key={o.s}
                    aria-pressed={ssort === o.s}
                    onClick={() => setSsort(o.s)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      ssort === o.s ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* solution composer; one per member, hidden when closed or when you've already solved */}
          {problem.closed ? (
            <p className="mb-4 rounded-lg bg-page px-3 py-2.5 text-sm text-muted">This problem is closed. New solutions are turned off.</p>
          ) : mySolution ? (
            <p className="mb-4 rounded-lg bg-page px-3 py-2.5 text-sm text-muted">You&rsquo;ve proposed a solution. Edit it below to update it.</p>
          ) : (
            <form onSubmit={addSolution} className="mb-4">
              <textarea
                aria-label="Propose a solution"
                className="input min-h-[44px] resize-y"
                placeholder="Propose a solution: your approach, why it fits, what it would take"
                maxLength={3000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => setComposerOpen(true)}
              />
              {(composerOpen || body) && (
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => { setBody(''); setComposerOpen(false) }}
                  >
                    Cancel
                  </button>
                  <button className="btn-primary" disabled={busy || !body.trim()}>
                    {busy ? 'Posting...' : 'Post solution'}
                  </button>
                </div>
              )}
            </form>
          )}

          {/* solutions list */}
          {solutions.length === 0 ? (
            <p className="py-2 text-sm text-muted">No solutions yet. Be the first.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sortedSolutions.map((s) => {
                const mine = s.author_id === uid
                return (
                  <li key={s.id} className="flex gap-2.5 py-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                      {(s.author_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <AuthorLink id={s.author_id} className="font-semibold text-ink">{s.author_name}</AuthorLink>
                        {s.id === topId && (
                          <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">Top solution</span>
                        )}
                        <span>· {timeAgo(s.created_at)}</span>
                        {(mine || isAdmin) && (
                          <span className="ml-auto flex items-center gap-2">
                            {mine && editingId !== s.id && (
                              <button onClick={() => startEdit(s)} className="inline-flex min-h-9 items-center rounded px-1 text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">edit</button>
                            )}
                            <button onClick={() => deleteSolution(s.id, mine)} className="inline-flex min-h-9 items-center rounded px-1 text-muted hover:text-down focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">delete</button>
                          </span>
                        )}
                      </div>
                      {s.title && <h3 className="mt-1 text-sm font-extrabold">{s.title}</h3>}
                      {editingId === s.id ? (
                        <div className="mt-1.5">
                          <textarea aria-label="Edit your solution" className="input min-h-[80px] resize-y" maxLength={3000} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                          {s.reviewed_at && <p className="mt-1 text-xs text-warnink">Saving clears your Impact/Feasibility score; a mentor will re-review.</p>}
                          <div className="mt-2 flex justify-end gap-2">
                            <button className="btn-outline px-3 py-1 text-xs" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
                            <button className="btn-primary px-3 py-1 text-xs" onClick={() => saveEdit(s)} disabled={busy || !editBody.trim()}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{s.description}</p>
                      )}
                      {s.course_context && (
                        <div className="mt-1.5 text-xs text-muted">
                          <span className="font-bold uppercase tracking-wide">Draws on:</span> {s.course_context}
                        </div>
                      )}
                      {s.reviewed_at ? (
                        <div className="mt-2 rounded-lg bg-page px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="chip">Impact {s.impact}/10</span>
                            <span className="chip">Feasibility {s.feasibility}/10</span>
                            {s.reviewer_name && <span className="ml-auto text-xs text-faint">by {s.reviewer_name}</span>}
                          </div>
                          {s.review_note && <p className="mt-1.5 text-xs text-muted">{s.review_note}</p>}
                        </div>
                      ) : isMentor && !mine ? (
                        <ReviewForm solutionId={s.id} onReviewed={refreshSolutions} />
                      ) : (
                        <div className="mt-1.5 text-xs font-semibold text-muted">Awaiting mentor review</div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {editOpen && (
            <ProblemModal
              edit={problem}
              onClose={() => setEditOpen(false)}
              onSaved={() => { setEditOpen(false); load() }}
            />
          )}
        </>
      )}
    </div>
  )
}

function ReviewForm({ solutionId, onReviewed }) {
  const [impact, setImpact] = useState(5)
  const [feasibility, setFeasibility] = useState(5)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scale = Array.from({ length: 10 }, (_, i) => i + 1)

  async function submit() {
    setBusy(true)
    setError('')
    const { error: e } = await supabase.rpc('review_solution', {
      p_solution: solutionId,
      p_impact: impact,
      p_feasibility: feasibility,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (e) { console.error(e); return setError('Could not save the score. Try again.') }
    onReviewed()
  }

  return (
    <div className="mt-2 rounded-lg bg-page px-3 py-2">
      {error && <div role="alert" className="mb-2 text-xs text-down">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          Impact
          <select className="input w-auto px-2 py-1" value={impact} onChange={(e) => setImpact(Number(e.target.value))}>
            {scale.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          Feasibility
          <select className="input w-auto px-2 py-1" value={feasibility} onChange={(e) => setFeasibility(Number(e.target.value))}>
            {scale.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn-outline ml-auto px-3 py-1 text-xs" onClick={submit} disabled={busy}>
          {busy ? 'Scoring...' : 'Score'}
        </button>
      </div>
      <input aria-label="Review note" className="input mt-2" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (optional)" />
    </div>
  )
}

function ProblemDetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-full bg-line" />
        <div className="h-3 w-28 rounded bg-line" />
      </div>
      <div className="mt-4 h-6 w-3/4 rounded bg-line" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-2/3 rounded bg-line" />
      </div>
      <div className="mt-6 h-10 w-full rounded-lg bg-line" />
    </div>
  )
}
