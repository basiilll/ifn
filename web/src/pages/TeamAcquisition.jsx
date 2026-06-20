import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, X, Trash2, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { linkedinUrl } from '../lib/linkedin'
import ModalShell from '../components/ModalShell'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../lib/AuthProvider'
import AuthorLink from '../components/AuthorLink'
import Spinner from '../components/Spinner'
import { timeAgo } from '../lib/format'

const GENERIC_ERR = 'Something went wrong. Please try again.'
const MAX_SKILLS = 10

export default function TeamAcquisition() {
  const { session, isAdmin } = useAuth()
  const uid = session?.user?.id

  const [posts, setPosts] = useState([])
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [postOpen, setPostOpen] = useState(false)
  const [editPost, setEditPost] = useState(null)
  const [applyTo, setApplyTo] = useState(null)
  const [applicantsFor, setApplicantsFor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.rpc('team_feed', { p_search: debounced || null })
    if (e) { console.error(e); setError('Could not load the board. Check your connection and retry.') } else { setError(''); setPosts(data || []) }
    setLoading(false)
  }, [debounced])
  useEffect(() => { load() }, [load])

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(''), 3000) }

  async function deletePost(id, mine) {
    const { error: e } = mine
      ? await supabase.from('team_posts').delete().eq('id', id)
      : await supabase.rpc('admin_delete_team_post', { p_id: id })
    if (e) { console.error(e); return setError('Could not delete the role need. Try again.') }
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  async function toggleClosed(post) {
    const { error: e } = await supabase.rpc('set_team_closed', { p_id: post.id, p_closed: !post.closed })
    if (e) { console.error(e); return setError('Could not update the role. Try again.') }
    flash(post.closed ? 'Role reopened.' : 'Role closed.')
    load()
  }

  async function withdraw(postId) {
    const { error: e } = await supabase
      .from('team_applications')
      .delete()
      .eq('team_post_id', postId)
      .eq('applicant_id', uid)
    if (e) { console.error(e); return setError('Could not withdraw your application. Try again.') }
    flash('Application withdrawn.')
    load()
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Team Acquisition</h1>
          <p className="mt-0.5 text-sm text-muted">Hiring for your startup? Post a role. Want to join one? Apply.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setPostOpen(true)}>
          <Plus size={16} /> Post a need
        </button>
      </div>

      <div className="relative mt-4">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search roles" placeholder="Search roles, skills, startups..."
        />
      </div>

      {notice && (
        <div role="status" className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}

      <div aria-live="polite" className="sr-only">
        {!loading && !error && `${posts.length} ${posts.length === 1 ? 'role' : 'roles'} match`}
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TeamCardSkeleton />
          <TeamCardSkeleton />
          <TeamCardSkeleton />
          <TeamCardSkeleton />
        </div>
      ) : error ? (
        <div className="card mt-4 p-6 text-center">
          <p className="text-sm text-down">{GENERIC_ERR}</p>
          <button className="btn-outline mt-3" onClick={load}>Retry</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="font-semibold">No role needs {debounced ? 'match this search' : 'yet'}.</p>
          {!debounced && <button className="btn-primary mt-4" onClick={() => setPostOpen(true)}>Post the first need</button>}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {posts.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`View role: ${t.title}`}
              onClick={() => setDetail(t)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t) } }}
              className={`card flex h-52 cursor-pointer flex-col overflow-hidden p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${t.closed ? 'opacity-60' : ''}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <AuthorLink id={t.author_id} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                  {(t.author_name || '?').charAt(0).toUpperCase()}
                </AuthorLink>
                <AuthorLink id={t.author_id} className="truncate text-sm font-bold">{t.author_name}</AuthorLink>
                {t.closed && <span className="rounded-md bg-down/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-down">Closed</span>}
                <span className="ml-auto shrink-0 text-xs text-faint">{timeAgo(t.created_at)}</span>
              </div>

              <h3 className="truncate text-base font-extrabold">{t.title}</h3>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                {t.startup && <span className="truncate font-semibold">{t.startup}</span>}
                {t.startup && t.looking_for && <span>·</span>}
                {t.looking_for && <span className="truncate">Looking for {t.looking_for}</span>}
              </div>
              {t.description && <p className="mt-2 line-clamp-2 break-words text-sm text-muted">{t.description}</p>}

              {t.skills?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden">
                  {t.skills.slice(0, 4).map((s) => (
                    <span key={s} className="rounded-md bg-page px-2 py-0.5 text-xs font-semibold text-ink ring-1 ring-line">{s}</span>
                  ))}
                  {t.skills.length > 4 && (
                    <span className="px-1 py-0.5 text-xs font-semibold text-muted">+{t.skills.length - 4}</span>
                  )}
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-3 text-xs font-semibold text-muted">
                {t.closed
                  ? <span className="text-down">Closed</span>
                  : t.is_mine
                    ? `${Number(t.app_count)} ${Number(t.app_count) === 1 ? 'applicant' : 'applicants'}`
                    : t.i_applied
                      ? <span className="text-accent">Applied</span>
                      : 'View and apply'}
                <ChevronRight size={16} className="ml-auto text-faint" />
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <DetailModal
          post={detail}
          isAdmin={isAdmin}
          onClose={() => setDetail(null)}
          onApply={() => { setApplyTo(detail); setDetail(null) }}
          onWithdraw={() => {
            const d = detail
            setDetail(null)
            setConfirm({
              title: 'Withdraw application?',
              message: 'Your application to this role will be removed.',
              confirmLabel: 'Withdraw',
              tone: 'danger',
              onConfirm: async () => { await withdraw(d.id); setConfirm(null) },
            })
          }}
          onEdit={() => { setEditPost(detail); setDetail(null) }}
          onApplicants={() => { setApplicantsFor(detail); setDetail(null) }}
          onToggleClosed={() => { toggleClosed(detail); setDetail(null) }}
          onDelete={() => {
            const d = detail
            setDetail(null)
            setConfirm({
              title: 'Delete this role need?',
              message: 'This permanently removes the role and its applications.',
              confirmLabel: 'Delete',
              tone: 'danger',
              onConfirm: async () => { await deletePost(d.id, d.is_mine); setConfirm(null) },
            })
          }}
        />
      )}

      {postOpen && (
        <PostNeedModal
          onClose={() => setPostOpen(false)}
          onSaved={() => { setPostOpen(false); flash('Role need posted.'); load() }}
        />
      )}
      {editPost && (
        <PostNeedModal
          edit={editPost}
          onClose={() => setEditPost(null)}
          onSaved={() => { setEditPost(null); flash('Role need updated.'); load() }}
        />
      )}
      {applyTo && (
        <ApplyModal
          post={applyTo}
          onClose={() => setApplyTo(null)}
          onSent={() => { setApplyTo(null); flash('Application sent.'); load() }}
        />
      )}
      {applicantsFor && (
        <ApplicantsModal post={applicantsFor} onClose={() => setApplicantsFor(null)} />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          tone={confirm.tone}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function DetailModal({ post, isAdmin, onClose, onApply, onWithdraw, onEdit, onApplicants, onToggleClosed, onDelete }) {
  return (
    <Shell title={post.title} onClose={onClose}>
      <div className="mt-3 flex items-center gap-2">
        <AuthorLink id={post.author_id} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
          {(post.author_name || '?').charAt(0).toUpperCase()}
        </AuthorLink>
        <AuthorLink id={post.author_id} className="truncate text-sm font-bold">{post.author_name}</AuthorLink>
        {post.closed && <span className="rounded-md bg-down/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-down">Closed</span>}
        <span className="ml-auto shrink-0 text-xs text-faint">{timeAgo(post.created_at)}</span>
      </div>

      {post.startup && <span className="mt-3 inline-flex w-fit chip">{post.startup}</span>}
      {post.description && (
        <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm text-ink">{post.description}</p>
      )}

      <dl className="mt-4 space-y-1.5 text-sm">
        {post.looking_for && <Row label="Looking for" value={post.looking_for} />}
        {post.commitment && <Row label="Commitment" value={post.commitment} />}
        {post.stage && <Row label="Stage" value={post.stage} />}
      </dl>

      {post.skills?.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Skills required</div>
          <div className="flex flex-wrap gap-1.5">
            {post.skills.map((s) => (
              <span key={s} className="rounded-md bg-page px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">{s}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {post.is_mine ? (
          <>
            <button className="btn-outline" onClick={onApplicants}>Applicants ({Number(post.app_count)})</button>
            <button className="btn-outline" onClick={onEdit}>Edit</button>
            <button className="btn-outline" onClick={onToggleClosed}>{post.closed ? 'Reopen' : 'Close'}</button>
          </>
        ) : post.i_applied ? (
          <button onClick={onWithdraw} className="btn inline-flex items-center border border-down/40 px-4 py-2 text-sm text-down transition-colors hover:bg-down/10">
            Withdraw application
          </button>
        ) : post.closed ? (
          <span className="text-sm font-semibold text-down">This role is closed.</span>
        ) : (
          <button className="btn-primary" onClick={onApply}>Apply</button>
        )}
        {isAdmin && !post.is_mine && (
          <>
            <button className="btn-outline" onClick={onApplicants}>Applicants ({Number(post.app_count)})</button>
            <button className="btn-outline" onClick={onToggleClosed}>{post.closed ? 'Reopen' : 'Close'}</button>
          </>
        )}
        {(post.is_mine || isAdmin) && (
          <button onClick={onDelete} aria-label="Delete" className="ml-auto rounded-full p-2 text-muted transition-colors hover:bg-black/5 hover:text-down">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </Shell>
  )
}

function TeamCardSkeleton() {
  return (
    <div className="card flex h-52 animate-pulse flex-col overflow-hidden p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-line" />
        <div className="h-3 w-24 rounded bg-line" />
        <div className="ml-auto h-2.5 w-10 rounded bg-line" />
      </div>
      <div className="h-4 w-3/5 rounded bg-line" />
      <div className="mt-2 h-5 w-20 rounded-md bg-line" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-4/5 rounded bg-line" />
      </div>
      <div className="mt-4 flex gap-1.5">
        <div className="h-6 w-14 rounded-md bg-line" />
        <div className="h-6 w-16 rounded-md bg-line" />
        <div className="h-6 w-12 rounded-md bg-line" />
      </div>
      <div className="mt-auto h-9 w-24 rounded-md bg-line" />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="break-words font-semibold">{value}</dd>
    </div>
  )
}

function Shell({ title, onClose, children }) {
  return (
    <ModalShell onRequestClose={onClose} labelledBy="shell-modal-title">
      <h2 id="shell-modal-title" className="break-words text-lg font-bold">{title}</h2>
      {children}
    </ModalShell>
  )
}

function PostNeedModal({ edit, onClose, onSaved }) {
  const { session } = useAuth()
  const [f, setF] = useState({
    title: edit?.title || '',
    startup: edit?.startup || '',
    description: edit?.description || '',
    looking_for: edit?.looking_for || '',
    commitment: edit?.commitment || '',
    stage: edit?.stage || 'Idea',
  })
  const [skills, setSkills] = useState(edit?.skills || [])
  const [skillInput, setSkillInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const initialRef = useRef(JSON.stringify({ ...f, skills: edit?.skills || [] }))
  const [fieldErr, setFieldErr] = useState({})
  const titleRef = useRef(null)
  const descRef = useRef(null)
  const lookingRef = useRef(null)
  const set = (k) => (e) => {
    setF((p) => ({ ...p, [k]: e.target.value }))
    setFieldErr((p) => (p[k] ? { ...p, [k]: '' } : p)) // clear a field's error as they fix it
  }

  function requestClose() {
    if (busy) return
    const dirty = JSON.stringify({ ...f, skills }) !== initialRef.current || skillInput.trim() !== ''
    if (dirty) { setConfirmDiscard(true); return }
    onClose()
  }

  function addSkill() {
    const s = skillInput.trim()
    if (!s) return
    if (skills.includes(s)) { setSkillInput(''); return }
    if (skills.length >= MAX_SKILLS) { setError(`Max ${MAX_SKILLS} skills.`); return }
    setSkills([...skills, s])
    setSkillInput('')
  }

  async function submit() {
    const errs = {}
    if (!f.title.trim()) errs.title = 'Add a role title.'
    if (!f.description.trim()) errs.description = 'Add a description.'
    if (!f.looking_for.trim()) errs.looking_for = 'Say who you are looking for.'
    if (errs.title || errs.description || errs.looking_for) {
      setFieldErr(errs)
      ;(errs.title ? titleRef : errs.description ? descRef : lookingRef).current?.focus()
      return
    }
    setFieldErr({})
    setBusy(true)
    const payload = {
      title: f.title.trim(),
      startup: f.startup.trim(),
      description: f.description.trim(),
      looking_for: f.looking_for.trim(),
      commitment: f.commitment.trim(),
      stage: f.stage.trim(),
      skills,
    }
    const { error: e } = edit
      ? await supabase.from('team_posts').update(payload).eq('id', edit.id)
      : await supabase.from('team_posts').insert({ ...payload, author_id: session.user.id })
    setBusy(false)
    if (e) { console.error(e); return setError('Could not save the role need. Check your connection and try again.') }
    onSaved()
  }

  return (
    <>
    <Shell title={edit ? 'Edit role need' : 'Post a role need'} onClose={requestClose}>
      {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <L label="Role title *" error={fieldErr.title}><input ref={titleRef} className="input" aria-invalid={!!fieldErr.title || undefined} maxLength={200} value={f.title} onChange={set('title')} placeholder="Full-Stack Developer" /></L>
          <L label="Startup"><input className="input" maxLength={200} value={f.startup} onChange={set('startup')} placeholder="FarmSense" /></L>
        </div>
        <L label="Description *" error={fieldErr.description}><textarea ref={descRef} className="input min-h-[70px] resize-y" aria-invalid={!!fieldErr.description || undefined} maxLength={1200} value={f.description} onChange={set('description')} placeholder="What you need and why" /></L>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <L label="Looking for *" error={fieldErr.looking_for}><input ref={lookingRef} className="input" aria-invalid={!!fieldErr.looking_for || undefined} maxLength={200} value={f.looking_for} onChange={set('looking_for')} placeholder="Co-founder" /></L>
          <L label="Commitment"><input className="input" maxLength={120} value={f.commitment} onChange={set('commitment')} placeholder="Part-time" /></L>
          <L label="Stage">
            <select className="input" value={f.stage} onChange={set('stage')}>
              <option>Idea</option><option>Prototype</option><option>Revenue</option>
            </select>
          </L>
        </div>
        <L label={`Skills required (${skills.length}/${MAX_SKILLS})`}>
          {skills.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="chip">{s}
                  <button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className="input" maxLength={60} value={skillInput} onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill() } }} placeholder="Add a skill, press Enter" />
            <button className="btn-outline shrink-0 px-4" type="button" onClick={addSkill}>Add</button>
          </div>
        </L>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving...' : edit ? 'Save changes' : 'Post'}
        </button>
      </div>
    </Shell>
    {confirmDiscard && (
      <ConfirmModal
        title={edit ? 'Discard your changes?' : 'Discard this role need?'}
        message="Your unsaved text will be lost."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => { setConfirmDiscard(false); onClose() }}
        onClose={() => setConfirmDiscard(false)}
      />
    )}
    </>
  )
}

function ApplyModal({ post, onClose, onSent }) {
  const [msg, setMsg] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  function requestClose() {
    if (busy) return
    if (msg.trim() || contact.trim()) { setConfirmDiscard(true); return }
    onClose()
  }

  async function send() {
    if (!msg.trim()) return setError('Write a short message before sending.')
    if (!contact.trim()) return setError('Add contact info so they can reach you.')
    setBusy(true)
    const { error: e } = await supabase.rpc('team_apply', {
      p_post: post.id,
      p_message: msg.trim(),
      p_contact: contact.trim(),
    })
    setBusy(false)
    if (e) { console.error(e); return setError(e.message === 'already applied' ? 'You already applied to this.' : 'Could not send your application. Check your connection and try again.') }
    onSent()
  }

  return (
    <>
    <Shell title={`Apply: ${post.title}`} onClose={requestClose}>
      <p className="mt-3 text-sm text-muted">
        Applying to <span className="font-bold text-ink">{post.author_name}</span>
        {post.startup ? <> for <span className="font-bold text-ink">{post.startup}</span></> : null}. They will see your message and the contact info you share here. Your account email stays private.
      </p>
      {error && <div role="alert" className="mt-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Message</span>
        <textarea
          className="input min-h-[100px] resize-y" maxLength={2000} value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Why you're a fit, links, availability..."
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Contact info *</span>
        <input
          className="input" maxLength={200} value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Email, phone, or @handle the poster can reach you on"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={send} disabled={busy}>
          {busy ? 'Sending...' : 'Send application'}
        </button>
      </div>
    </Shell>
    {confirmDiscard && (
      <ConfirmModal
        title="Discard this application?"
        message="Your unsaved text will be lost."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => { setConfirmDiscard(false); onClose() }}
        onClose={() => setConfirmDiscard(false)}
      />
    )}
    </>
  )
}

function ApplicantsModal({ post, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('team_applicants', { p_post: post.id }).then(({ data, error: e }) => {
      if (e) { console.error(e); setError('Could not load applicants. Try again.') } else setRows(data || [])
    })
  }, [post.id])

  return (
    <Shell title={`Applicants: ${post.title}`} onClose={onClose}>
      {error ? (
        <p className="mt-4 text-sm text-down">{GENERIC_ERR}</p>
      ) : rows === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted"><Spinner /> Loading...</div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No applications yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <AuthorLink id={r.applicant_id} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                  {(r.applicant_name || '?').charAt(0).toUpperCase()}
                </AuthorLink>
                <AuthorLink id={r.applicant_id} className="text-sm font-bold">{r.applicant_name}</AuthorLink>
                <span className="ml-auto text-xs text-faint">{timeAgo(r.created_at)}</span>
              </div>
              {r.applicant_startup && <div className="mt-1 text-xs font-semibold text-muted">{r.applicant_startup}</div>}
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{r.message}</p>
              <div className="mt-2 break-words rounded-lg bg-page px-3 py-2 text-sm">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">Contact</span>
                <div className="font-semibold text-ink">{r.contact || 'Not provided'}</div>
              </div>
              {linkedinUrl(r.applicant_linkedin) && (
                <a href={linkedinUrl(r.applicant_linkedin)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
                  View LinkedIn<span className="sr-only"> (opens in new tab)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end">
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Shell>
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
