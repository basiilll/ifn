import { useEffect, useRef, useState } from 'react'
import { X, FileText, ArrowLeft } from 'lucide-react'
import ModalShell from './ModalShell'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'
import { errMessage } from '../lib/errors'

const MAX_TAGS = 10

// One generic post: title + body + tags. (Kinds/ideas/problems were retired from the feed.)
export default function CreatePostModal({ open, onClose, onCreated, onUpdated, editPost }) {
  const isEdit = !!editPost
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [tags, setTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // snapshot of the form as it was opened/loaded; close() compares against it
  const initialRef = useRef('')
  const formSnap = (f) => JSON.stringify(f)

  // drafts live inside the create flow (like Reddit's composer / Instagram's gallery)
  const [drafts, setDrafts] = useState([])
  const [view, setView] = useState('form') // 'form' | 'drafts'
  const [draft, setDraft] = useState(null) // the loaded draft being edited

  async function fetchDrafts() {
    const { data } = await supabase
      .from('posts')
      .select('id, title, problem, created_at, post_tags(tags(name))')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
    setDrafts(data || [])
  }

  // prefill on open (edit) or reset (create); creating also loads your drafts
  useEffect(() => {
    if (!open) return
    setDraft(null)
    setView('form')
    if (editPost) {
      setTitle(editPost.title || '')
      setBody(editPost.problem || '')
      setTags(editPost.tags || [])
    } else {
      setTitle(''); setBody(''); setAnonymous(false); setTags([])
      fetchDrafts()
    }
    setTagInput(''); setError('')
    initialRef.current = formSnap({
      title: editPost?.title || '',
      body: editPost?.problem || '',
      tags: editPost?.tags || [],
    })
  }, [open, editPost])

  if (!open) return null

  function close() {
    if (busy) return
    const dirty =
      view === 'form' &&
      (formSnap({ title, body, tags }) !== initialRef.current || tagInput.trim() !== '')
    if (dirty && !window.confirm(isEdit ? 'Discard your changes?' : 'Discard this post? Your text will be lost.')) return
    onClose()
  }

  function loadDraft(d) {
    setTitle(d.title || '')
    setBody(d.problem || '')
    setTags(d.post_tags?.map((pt) => pt.tags?.name).filter(Boolean) || [])
    setDraft(d)
    setView('form')
    setError('')
    initialRef.current = formSnap({
      title: d.title || '',
      body: d.problem || '',
      tags: d.post_tags?.map((pt) => pt.tags?.name).filter(Boolean) || [],
    })
  }

  async function deleteDraft(id) {
    if (!window.confirm('Delete this draft?')) return
    const { error: e } = await supabase.from('posts').delete().eq('id', id)
    if (e) { console.error(e); return setError('Could not delete the draft. Try again.') }
    fetchDrafts()
  }

  function addTag() {
    const t = tagInput.replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!t) return
    if (t === 'success') {
      setError("#Success is a verified badge. Request it from your post's menu after publishing.")
      setTagInput('')
      return
    }
    if (tags.includes(t)) { setTagInput(''); return }
    if (tags.length >= MAX_TAGS) { setError(`Max ${MAX_TAGS} tags.`); return }
    setTags([...tags, t])
    setTagInput('')
  }
  function onTagKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
  }

  async function save(status) {
    setError('')
    // Publishing needs both; a draft is partial work — save with whatever's there,
    // requiring only that it isn't completely empty.
    const isDraft = status === 'draft'
    if (isDraft) {
      if (!title.trim() && !body.trim()) return setError('Add a title or some text to save a draft.')
    } else {
      if (!title.trim()) return setError('Title is required.')
      if (!body.trim()) return setError('Body is required.')
    }

    setBusy(true)
    try {
      if (isEdit || draft) {
        const id = isEdit ? editPost.id : draft.id
        const { error: rpcErr } = await supabase.rpc('update_post', {
          p_id: id,
          p_title: title.trim(),
          p_problem: body.trim(),
          p_solution: null,
          p_startup: null,
          p_tags: tags,
        })
        if (rpcErr) { console.error(rpcErr); setError(errMessage(rpcErr, 'Could not save your post. Check your connection and try again.')); return }
        if (isEdit) { onUpdated?.(); return }
        // loaded draft: optionally publish after saving the edits
        if (status === 'published') {
          const { error: pubErr } = await supabase.rpc('publish_post', { p_id: id })
          if (pubErr) { console.error(pubErr); setError('Saved, but publishing failed. Open it from your drafts and publish again.'); return }
        }
        onCreated?.(status)
      } else {
        const { error: rpcErr } = await supabase.rpc('create_post', {
          p_kind: 'post',
          p_title: title.trim(),
          p_problem: body.trim(),
          p_solution: null,
          p_startup: null,
          p_anonymous: anonymous,
          p_status: status,
          p_tags: tags,
        })
        if (rpcErr) { console.error(rpcErr); setError(errMessage(rpcErr, 'Could not save your post. Check your connection and try again.')); return }
        onCreated?.(status)
      }
    } catch {
      setError('Could not save your post. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onRequestClose={close} labelledBy="create-post-title">
      <form onSubmit={(e) => { e.preventDefault(); save('published') }}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="create-post-title" className="flex items-center gap-2 text-lg font-bold">
            {view === 'drafts' && (
              <button type="button" onClick={() => setView('form')} aria-label="Back" className="rounded-full p-1 text-muted hover:bg-black/5">
                <ArrowLeft size={18} />
              </button>
            )}
            {isEdit ? 'Edit post' : view === 'drafts' ? 'Your drafts' : draft ? 'Edit draft' : 'Create post'}
          </h2>
          {!isEdit && view === 'form' && drafts.length > 0 && (
            <button
              type="button"
              onClick={() => setView('drafts')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-black/5"
            >
              <FileText size={14} /> Drafts ({drafts.length})
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>
        )}

        {view === 'drafts' ? (
          <>
            <ul className="mt-4 divide-y divide-line">
              {drafts.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-2.5">
                  <button type="button" onClick={() => loadDraft(d)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{d.title || 'Untitled'}</span>
                      <span className="block text-xs text-muted">Saved {timeAgo(d.created_at)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDraft(d.id)}
                    aria-label="Delete draft"
                    className="shrink-0 rounded-full p-1.5 text-faint transition-colors hover:bg-black/5 hover:text-down"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {drafts.length === 0 && <p className="mt-4 text-sm text-muted">No drafts left.</p>}
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <input className="input" placeholder="Title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea
                className="input min-h-[120px] resize-y"
                placeholder="Share an idea, a problem, a question, or a win"
                maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)}
              />

              {/* supertags */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted">Tags ({tags.length}/{MAX_TAGS})</div>
                {tags.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span key={t} className="chip">
                        #{t}
                        <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="input" placeholder="Type a tag, press Enter" maxLength={30}
                    value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={onTagKey}
                  />
                  <button type="button" className="btn-outline shrink-0 px-4" onClick={addTag}>Add</button>
                </div>
              </div>

              {!isEdit && !draft && (
                <>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                    Post anonymously
                  </label>
                  {anonymous && (
                    <p className="text-xs text-muted">Your post will appear as "Anonymous Founder".</p>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={close} disabled={busy}>Cancel</button>
              {isEdit ? (
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
              ) : (
                <>
                  <button type="button" className="btn-outline" onClick={() => save('draft')} disabled={busy}>
                    {draft ? 'Save draft' : 'Save as draft'}
                  </button>
                  <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Posting...' : 'Publish'}</button>
                </>
              )}
            </div>
          </>
        )}
      </form>
    </ModalShell>
  )
}
