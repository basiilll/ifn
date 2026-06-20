import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import ModalShell from './ModalShell'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/errors'

const MIN_OPTIONS = 2
const MAX_OPTIONS = 8

// Admin-only poll composer. Members later get one vote each (see PollBlock).
export default function CreatePollModal({ open, onClose, onCreated }) {
  const [question, setQuestion] = useState('')
  const [body, setBody] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuestion(''); setBody(''); setOptions(['', '']); setError('')
  }, [open])

  if (!open) return null

  const setOption = (i, v) => setOptions((o) => o.map((x, j) => (j === i ? v : x)))
  const addOption = () => setOptions((o) => (o.length >= MAX_OPTIONS ? o : [...o, '']))
  const removeOption = (i) => setOptions((o) => (o.length <= MIN_OPTIONS ? o : o.filter((_, j) => j !== i)))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!question.trim()) return setError('Question is required.')
    const opts = options.map((o) => o.trim()).filter(Boolean)
    if (opts.length < MIN_OPTIONS) return setError(`Add at least ${MIN_OPTIONS} options.`)
    setBusy(true)
    const { error: e2 } = await supabase.rpc('create_poll', {
      p_title: question.trim(),
      p_body: body.trim() || null,
      p_options: opts,
      p_tags: [],
    })
    setBusy(false)
    if (e2) { console.error(e2); return setError(errMessage(e2, 'Could not create the poll. Try again.')) }
    onCreated?.()
  }

  return (
    <ModalShell onRequestClose={() => !busy && onClose()} labelledBy="create-poll-title">
      <form onSubmit={submit}>
        <h2 id="create-poll-title" className="text-lg font-bold">Create poll</h2>
        <p className="mt-0.5 text-xs text-muted">Admin only. Members get one vote each; results show after they vote.</p>

        {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

        <div className="mt-4 space-y-3">
          <input className="input" placeholder="Poll question" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <textarea className="input min-h-[60px] resize-y" placeholder="Add context (optional)" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Options ({options.length}/{MAX_OPTIONS})</div>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" placeholder={`Option ${i + 1}`} maxLength={120} value={o} onChange={(e) => setOption(i, e.target.value)} />
                {options.length > MIN_OPTIONS && (
                  <button type="button" onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`} className="shrink-0 rounded-lg border border-line px-2 text-muted hover:bg-black/5">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <button type="button" onClick={addOption} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                <Plus size={14} /> Add option
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create poll'}</button>
        </div>
      </form>
    </ModalShell>
  )
}
