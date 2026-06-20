import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import ModalShell from './ModalShell'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

const MAX_TAGS = 6

// Post / edit a problem. Pass `edit` (the problem row) to edit; omit it to create.
export default function ProblemModal({ edit, onClose, onSaved }) {
  const { session } = useAuth()
  const [f, setF] = useState({
    title: edit?.title || '',
    description: edit?.description || '',
    deadline: edit?.deadline || '',
  })
  const [tags, setTags] = useState(edit?.tags || [])
  const [tagInput, setTagInput] = useState('')
  const initialRef = useRef(JSON.stringify({
    title: edit?.title || '',
    description: edit?.description || '',
    deadline: edit?.deadline || '',
    tags: edit?.tags || [],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErr, setFieldErr] = useState({})
  const titleRef = useRef(null)
  const descRef = useRef(null)
  const set = (k) => (e) => {
    setF((p) => ({ ...p, [k]: e.target.value }))
    setFieldErr((p) => (p[k] ? { ...p, [k]: '' } : p)) // clear a field's error as they fix it
  }

  function requestClose() {
    if (busy) return
    const dirty =
      JSON.stringify({ title: f.title, description: f.description, deadline: f.deadline, tags }) !== initialRef.current ||
      tagInput.trim() !== ''
    if (dirty && !window.confirm(edit ? 'Discard your changes?' : 'Discard this problem? Your text will be lost.')) return
    onClose()
  }

  function addTag() {
    const t = tagInput.trim()
    if (!t) return
    if (tags.includes(t)) { setTagInput(''); return }
    if (tags.length >= MAX_TAGS) { setError(`Max ${MAX_TAGS} tags.`); return }
    setTags([...tags, t])
    setTagInput('')
  }

  async function submit() {
    const errs = {}
    if (!f.title.trim()) errs.title = 'Add a problem title.'
    if (!f.description.trim()) errs.description = 'Add a description.'
    if (errs.title || errs.description) {
      setFieldErr(errs)
      ;(errs.title ? titleRef : descRef).current?.focus() // jump to the first thing missing
      return
    }
    setFieldErr({})
    setBusy(true)
    const payload = {
      title: f.title.trim(),
      description: f.description.trim(),
      deadline: f.deadline || null,
      tags,
    }
    const { error: e } = edit
      ? await supabase.from('problems').update(payload).eq('id', edit.id)
      : await supabase.from('problems').insert({ ...payload, author_id: session.user.id })
    setBusy(false)
    if (e) { console.error(e); return setError('Could not save the problem. Check your connection and try again.') }
    onSaved()
  }

  return (
    <ModalShell onRequestClose={requestClose} labelledBy="problem-modal-title">
      <h2 id="problem-modal-title" className="text-lg font-bold">{edit ? 'Edit problem' : 'Post a problem'}</h2>
        <p className="mt-2 text-sm text-muted">Describe a real problem you face. Members reply with solutions; mentors score them.</p>
        {error && <div role="alert" className="mt-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
        <div className="mt-4 space-y-3">
          <L label="Problem title *" error={fieldErr.title}><input ref={titleRef} className="input" aria-invalid={!!fieldErr.title || undefined} maxLength={200} value={f.title} onChange={set('title')} placeholder="Farmers cannot verify soil quality cheaply" /></L>
          <L label="Description *" error={fieldErr.description}><textarea ref={descRef} className="input min-h-[100px] resize-y" aria-invalid={!!fieldErr.description || undefined} maxLength={3000} value={f.description} onChange={set('description')} placeholder="The context, who is affected, what a good solution looks like" /></L>
          <L label="Needed by"><input className="input" type="date" value={f.deadline} onChange={set('deadline')} /></L>
          <L label={`Domain tags (${tags.length}/${MAX_TAGS})`}>
            {tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="chip">{t}
                    <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className="input" maxLength={40} value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} placeholder="Add a tag, press Enter" />
              <button className="btn-outline shrink-0 px-4" type="button" onClick={addTag}>Add</button>
            </div>
          </L>
        </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={requestClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving...' : edit ? 'Save changes' : 'Post'}
        </button>
      </div>
    </ModalShell>
  )
}

function L({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-down">{error}</p>}
    </label>
  )
}
