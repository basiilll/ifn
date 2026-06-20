import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, CalendarClock, MessageCircle, ArrowBigUp, ArrowBigDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import AuthorLink from '../components/AuthorLink'
import ProblemModal from '../components/ProblemModal'
import { timeAgo } from '../lib/format'

const GENERIC_ERR = 'Something went wrong. Please try again.'

export default function ProblemHub() {
  const { session } = useAuth()

  const [problems, setProblems] = useState([])
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [postOpen, setPostOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [voting, setVoting] = useState(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.rpc('problem_feed', { p_search: debounced || null })
    if (e) { console.error(e); setError('Could not load problems. Check your connection and retry.') } else { setError(''); setProblems(data || []) }
    setLoading(false)
  }, [debounced])
  useEffect(() => { load() }, [load])

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(''), 3000) }

  async function vote(e, problemId, v) {
    e.stopPropagation()
    if (voting === problemId) return
    const prob = problems.find((p) => p.id === problemId)
    if (!prob) return
    const prevScore = Number(prob.score)
    const prevVote = prob.my_vote ?? 0
    const nextVote = prevVote === v ? 0 : v
    setProblems((prev) => prev.map((p) =>
      p.id !== problemId ? p : { ...p, score: prevScore + (nextVote - prevVote), my_vote: nextVote || null }
    ))
    setVoting(problemId)
    try {
      if (nextVote === 0) {
        await supabase.from('problem_votes').delete().eq('problem_id', problemId).eq('user_id', session?.user?.id)
      } else {
        await supabase.from('problem_votes').upsert({ problem_id: problemId, user_id: session?.user?.id, value: nextVote })
      }
    } catch {
      setProblems((prev) => prev.map((p) =>
        p.id !== problemId ? p : { ...p, score: prevScore, my_vote: prevVote || null }
      ))
    } finally {
      setVoting(null)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Problem Hub</h1>
          <p className="mt-0.5 text-sm text-muted">Real-world problems from the network. Open one to read the thread and reply with a solution.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setPostOpen(true)}>
          <Plus size={16} /> Post a problem
        </button>
      </div>

      <div className="relative mt-4">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          aria-label="Search problems"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search problems, tags..."
        />
      </div>

      {notice && (
        <div role="status" className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}

      {loading ? (
        <div className="mt-4 space-y-4">
          <ProblemCardSkeleton />
          <ProblemCardSkeleton />
          <ProblemCardSkeleton />
        </div>
      ) : error ? (
        <div className="card mt-4 p-6 text-center">
          <p className="text-sm text-down">{GENERIC_ERR}</p>
          <button className="btn-outline mt-3" onClick={load}>Retry</button>
        </div>
      ) : problems.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="font-semibold">No problems {debounced ? 'match this search' : 'posted yet'}.</p>
          {!debounced && <button className="btn-primary mt-4" onClick={() => setPostOpen(true)}>Post the first problem</button>}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {problems.map((p) => (
            <article
              key={p.id}
              className={`card relative p-5 transition focus-within:ring-2 focus-within:ring-accent/50 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop ${p.closed ? 'opacity-60' : ''}`}
            >
              <header className="flex items-center gap-2">
                <AuthorLink id={p.author_id} className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                  {(p.author_name || '?').charAt(0).toUpperCase()}
                </AuthorLink>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AuthorLink id={p.author_id} className="relative z-10 truncate text-sm font-bold">{p.author_name}</AuthorLink>
                  </div>
                  <div className="text-xs text-muted">{timeAgo(p.created_at)}</div>
                </div>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {p.closed && (
                    <span className="rounded-md bg-down/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-down">Closed</span>
                  )}
                </span>
              </header>

              <h3 className="mt-3 break-words text-base font-bold">
                <Link
                  to={`/problem-hub/${p.id}`}
                  className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none"
                >
                  {p.title}
                </Link>
              </h3>
              {p.deadline && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <CalendarClock size={13} />
                  <span>Needed by {new Date(p.deadline).toLocaleDateString()}</span>
                </div>
              )}
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm text-ink">{p.description}</p>

              {p.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="chip">{t}</span>
                  ))}
                </div>
              )}

              <footer className="mt-3 flex items-center gap-2">
                <div onClick={(e) => e.stopPropagation()} className="relative z-10 inline-flex items-center gap-1 rounded-lg bg-line/40 px-1 py-0.5">
                  <button
                    onClick={(e) => vote(e, p.id, 1)}
                    aria-label="Upvote"
                    aria-pressed={p.my_vote === 1}
                    className={`grid min-h-9 min-w-9 place-items-center rounded-full transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${p.my_vote === 1 ? 'text-accent' : 'text-muted'}`}
                  >
                    <ArrowBigUp size={20} fill={p.my_vote === 1 ? 'currentColor' : 'none'} />
                  </button>
                  <span
                    aria-live="polite"
                    aria-label={`${Number(p.score) || 0} points`}
                    className={`min-w-[2ch] text-center text-sm font-bold ${p.my_vote > 0 ? 'text-accent' : p.my_vote < 0 ? 'text-down' : 'text-ink'}`}
                  >
                    {Number(p.score) || 0}
                  </span>
                  <button
                    onClick={(e) => vote(e, p.id, -1)}
                    aria-label="Downvote"
                    aria-pressed={p.my_vote === -1}
                    className={`grid min-h-9 min-w-9 place-items-center rounded-full transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${p.my_vote === -1 ? 'text-down' : 'text-muted'}`}
                  >
                    <ArrowBigDown size={20} fill={p.my_vote === -1 ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <span className="relative z-10 inline-flex items-center gap-1.5 rounded-lg bg-line/40 px-3 py-2 text-sm font-semibold text-muted">
                  <MessageCircle size={18} /> {Number(p.solution_count)} {Number(p.solution_count) === 1 ? 'solution' : 'solutions'}
                </span>
                {p.i_solved && <span className="text-xs font-semibold text-accent">You replied</span>}
              </footer>
            </article>
          ))}
        </div>
      )}

      {postOpen && (
        <ProblemModal
          onClose={() => setPostOpen(false)}
          onSaved={() => { setPostOpen(false); flash('Problem posted.'); load() }}
        />
      )}
    </div>
  )
}

function ProblemCardSkeleton() {
  return (
    <div className="card animate-pulse p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-9 w-9 rounded-full bg-line" />
        <div className="h-3 w-24 rounded bg-line" />
        <div className="ml-auto h-2.5 w-10 rounded bg-line" />
      </div>
      <div className="h-4 w-3/5 rounded bg-line" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-4/5 rounded bg-line" />
      </div>
      <div className="mt-4 flex gap-1.5">
        <div className="h-6 w-14 rounded-full bg-line" />
        <div className="h-6 w-16 rounded-full bg-line" />
        <div className="h-6 w-12 rounded-full bg-line" />
      </div>
    </div>
  )
}
