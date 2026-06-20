import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

// Renders an admin poll inline. Single choice; tallies stay hidden until the viewer votes
// (matches poll_results' i_voted gate). Lives inside a clickable card, so it stops propagation.
export default function PollBlock({ postId }) {
  const { session } = useAuth()
  const uid = session?.user?.id
  const [options, setOptions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const { data, error } = await supabase.rpc('poll_results', { p_post: postId })
    if (error) { console.error(error); setErr('Could not load this poll.'); return }
    setErr('')
    setOptions(data || [])
  }
  useEffect(() => { load() }, [postId]) // eslint-disable-line react-hooks/exhaustive-deps

  const iVoted = options?.some((o) => o.my_choice)
  const total = options?.reduce((s, o) => s + Number(o.votes), 0) || 0

  async function vote(e, optionId) {
    e.stopPropagation()
    if (busy || !uid) return
    setBusy(true)
    const { error } = await supabase.rpc('poll_vote', { p_post: postId, p_option: optionId })
    setBusy(false)
    if (error) { console.error(error); setErr('Vote not saved. Try again.'); return }
    load()
  }

  if (!options) return <div className="mt-3 h-24 animate-pulse rounded-lg bg-page" />
  if (options.length === 0) return null

  return (
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      {options.map((o) => {
        const pct = total > 0 ? Math.round((Number(o.votes) / total) * 100) : 0
        return (
          <button
            key={o.option_id}
            type="button"
            onClick={(e) => vote(e, o.option_id)}
            disabled={busy}
            aria-pressed={o.my_choice}
            className={`relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-70 ${
              o.my_choice ? 'border-accent' : 'border-line hover:border-accent/50'
            }`}
          >
            {iVoted && (
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-full origin-left transition-transform duration-500 ease-out motion-reduce:transition-none ${o.my_choice ? 'bg-accent-soft' : 'bg-page'}`}
                style={{ transform: `scaleX(${pct / 100})` }}
              />
            )}
            <span className="relative flex items-center justify-between gap-2 text-sm">
              <span className={`font-semibold ${o.my_choice ? 'text-accent' : 'text-ink'}`}>{o.label}</span>
              {iVoted && <span className="shrink-0 text-xs font-bold text-muted">{pct}%</span>}
            </span>
          </button>
        )
      })}
      <div className="flex items-center gap-2 text-xs text-muted">
        {iVoted ? `${total} ${total === 1 ? 'vote' : 'votes'} · tap to change` : 'Tap an option to vote and see results'}
        {err && <span className="font-semibold text-down">· {err}</span>}
      </div>
    </div>
  )
}
