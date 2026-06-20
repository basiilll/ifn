import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Inbox, ClipboardCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import Spinner from '../components/Spinner'
import { PipelineListSkeleton } from '../components/PipelineSkeleton'
import { timeAgo } from '../lib/format'
import { SECTORS } from '../lib/options'
import { gateLabel, waitingChip, STATES, ifnTag } from '../lib/pipeline'

const GENERIC_ERR = 'Something went wrong. Please try again.'

// Mentor home: the pull-queue (unassigned G1 ideas, self-pick) + my assigned ideas.
export default function MentorReview() {
  const navigate = useNavigate()
  const { profile, isMentor } = useAuth()

  const [tab, setTab] = useState('mine') // 'mine' | 'queue'
  const [queue, setQueue] = useState([])
  const [mine, setMine] = useState([])
  const [sector, setSector] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [q, m] = await Promise.all([
      supabase.rpc('mentor_queue', { p_sector: sector || null }),
      supabase.rpc('my_mentees'),
    ])
    if (q.error || m.error) { console.error(q.error || m.error); setError('Could not load your review queue. Check your connection and retry.') }
    else {
      setQueue(q.data || [])
      setMine(m.data || [])
      if (!sector && (m.data || []).length === 0 && (q.data || []).length > 0) setTab('queue')
    }
    setLoading(false)
  }, [sector])

  useEffect(() => { if (isMentor) load() }, [isMentor, load])

  if (profile && !isMentor) return <Navigate to="/" replace />
  if (!profile) return <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Checking access...</div>

  async function pick(ideaId) {
    setBusyId(ideaId)
    const { error: e } = await supabase.rpc('mentor_pick', { p_idea: ideaId })
    setBusyId(null)
    if (e) { console.error(e); return setError(e.message?.includes('available') ? 'Someone else picked this idea first.' : GENERIC_ERR) }
    navigate(`/pipeline/${ideaId}`)
  }

  const needsMe = mine.filter((r) => r.waiting_on === 'mentor').length

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-extrabold">Mentor Review</h1>
      <p className="mt-0.5 text-sm text-muted">Pick ideas from the queue and guide them G3 to G6.</p>

      <div role="tablist" aria-label="Mentor review queues" className="mt-4 flex flex-wrap items-center gap-2">
        <Tab active={tab === 'mine'} onClick={() => setTab('mine')} icon={ClipboardCheck}>
          My ideas ({mine.length}{needsMe > 0 ? ` · ${needsMe} need you` : ''})
        </Tab>
        <Tab active={tab === 'queue'} onClick={() => setTab('queue')} icon={Inbox}>
          Available ideas ({queue.length})
        </Tab>
        {tab === 'queue' && (
          <select
            aria-label="Filter available ideas by sector"
            className="input ml-auto w-auto py-2 text-xs"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          >
            <option value="">All sectors</option>
            {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

      <div role="tabpanel" aria-label={tab === 'queue' ? 'Available ideas' : 'My ideas'}>
      {loading ? (
        <PipelineListSkeleton />
      ) : tab === 'queue' ? (
        queue.length === 0 ? (
          <div className="card mt-4 p-8 text-center">
            <p className="font-semibold">{sector ? `No ${sector} applications waiting.` : 'The queue is empty.'}</p>
            <p className="mt-1 text-sm text-muted">
              {sector ? 'Try another sector or clear the filter.' : 'Every submitted idea has a mentor. New ones land here first.'}
            </p>
          </div>
        ) : (
          <div className="card mt-4 divide-y divide-line">
            {queue.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-ink">{ifnTag(r.ifn)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</span>
                  {r.sector && (
                    <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">{r.sector}</span>
                  )}
                  <span className="shrink-0 text-xs text-faint">{timeAgo(r.created_at)}</span>
                </div>
                {r.problem && <p className="mt-1 text-sm text-muted line-clamp-2">{r.problem}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-xs text-muted">
                    {r.author_name}
                    {r.target_user && <> · for {r.target_user}</>}
                  </span>
                  <button
                    className="btn-primary ml-auto min-h-9 shrink-0 px-3 py-2 text-xs"
                    disabled={busyId === r.id}
                    onClick={() => pick(r.id)}
                  >
                    {busyId === r.id ? 'Picking...' : 'Pick up this idea'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : mine.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="font-semibold">No ideas assigned to you yet.</p>
          <p className="mt-1 text-sm text-muted">Pick one from the Available ideas tab to start mentoring.</p>
        </div>
      ) : (
        <div className="card mt-4 divide-y divide-line">
          {mine.map((r) => {
            const w = waitingChip(r.waiting_on)
            const st = STATES[r.pipeline_state]
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/pipeline/${r.id}`)}
                className="block w-full p-4 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-ink">{ifnTag(r.ifn)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</span>
                  {r.pipeline_state !== 'active' && st ? (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
                  ) : (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${w.tone}`}>{w.label}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted">
                  <span className="font-semibold text-ink">G{r.gate} · {gateLabel(r.gate)}</span>
                  <span> · {r.author_name}</span>
                  <span> · in this gate {timeAgo(r.entered_gate_at)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}

function Tab({ active, onClick, icon: Ic, children }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink hover:bg-black/5'
      }`}
    >
      <Ic size={15} /> {children}
    </button>
  )
}
