import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, X, Trash2, ChevronRight, IndianRupee } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { linkedinUrl } from '../lib/linkedin'
import ModalShell from '../components/ModalShell'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../lib/AuthProvider'
import AuthorLink from '../components/AuthorLink'
import Spinner from '../components/Spinner'
import { timeAgo, daysSince } from '../lib/format'

const GENERIC_ERR = 'Something went wrong. Please try again.'
const MAX_SKILLS = 10

// Per-kind copy. A post's `kind` ('offer' | 'request') drives every label so the two tabs share
// one machine: post -> respond (message + contact) -> the poster sees a list and reaches out.
const KIND = {
  offer: {
    tab: 'Offering',
    cta: 'Post an offer',
    respond: 'Express interest',
    respondPast: 'Interested',
    listLabel: 'Interested',
    listOne: 'interested',
    listMany: 'interested',
    postedMsg: 'Offer posted.',
    updatedMsg: 'Offer updated.',
    emptyTitle: 'No offers yet.',
    emptyHint: 'Got a skill? Be the first to offer one.',
    crossTab: null,
  },
  request: {
    tab: 'Looking for',
    cta: 'Post a request',
    respond: "I'm interested",
    respondPast: 'Interested',
    listLabel: 'Responders',
    listOne: 'responder',
    listMany: 'responders',
    postedMsg: 'Request posted.',
    updatedMsg: 'Request updated.',
    emptyTitle: 'No requests yet.',
    emptyHint: 'Need a service or someone to hire? Post what you need.',
    crossTab: 'Got a skill instead? Switch to Offering and share it.',
  },
}
const meta = (kind) => KIND[kind] || KIND.request

export default function Services() {
  const { session, isAdmin } = useAuth()
  const uid = session?.user?.id

  const [tab, setTab] = useState('offer') // 'offer' | 'request', Offering is the default
  const [posts, setPosts] = useState([])
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [postOpen, setPostOpen] = useState(false)
  const [editPost, setEditPost] = useState(null)
  const [respondTo, setRespondTo] = useState(null)
  const [respondersFor, setRespondersFor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)
  // discovery filters (client-side, over the loaded tab)
  const [openOnly, setOpenOnly] = useState(false)
  const [payFilter, setPayFilter] = useState('all') // 'all' | 'paid' | 'free' (request tab only)
  const [skillFilter, setSkillFilter] = useState(null)
  const [match, setMatch] = useState(null) // {count, skill, kind} counterpart matches for the open post

  const m = meta(tab)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.rpc('team_feed', { p_search: debounced || null, p_kind: tab })
    if (e) { console.error(e); setError('Could not load the board. Check your connection and retry.') } else { setError(''); setPosts(data || []) }
    setLoading(false)
  }, [debounced, tab])
  useEffect(() => { load() }, [load])

  // Manual tab switch resets the per-tab filters (search persists across tabs).
  function switchTab(k) { setTab(k); setSkillFilter(null); setPayFilter('all') }

  // Filter to a skill from the opposite tab (used by the match hint and detail skill chips).
  function filterBySkill(kind, skill) { setDetail(null); setTab(kind); setSkillFilter(skill); setPayFilter('all'); setOpenOnly(false) }

  const hasFilters = openOnly || payFilter !== 'all' || !!skillFilter
  function clearFilters() { setOpenOnly(false); setPayFilter('all'); setSkillFilter(null) }

  const shown = posts.filter((p) => {
    if (openOnly && p.closed) return false
    if (tab === 'request' && payFilter === 'paid' && !p.paid) return false
    if (tab === 'request' && payFilter === 'free' && p.paid) return false
    if (skillFilter && !(p.skills || []).includes(skillFilter)) return false
    return true
  })

  // When a post detail opens, count open counterpart posts that share a skill, so we can nudge
  // "N offers match these skills". Cheap lazy fetch of the opposite kind.
  useEffect(() => {
    setMatch(null)
    const skills = detail?.skills
    if (!detail || !skills?.length) return
    const opp = detail.kind === 'offer' ? 'request' : 'offer'
    let active = true
    supabase.rpc('team_feed', { p_search: null, p_kind: opp }).then(({ data }) => {
      if (!active || !data) return
      const matches = data.filter((p) => !p.closed && p.author_id !== uid && (p.skills || []).some((s) => skills.includes(s)))
      if (!matches.length) return
      const shared = {}
      matches.forEach((p) => (p.skills || []).forEach((s) => { if (skills.includes(s)) shared[s] = (shared[s] || 0) + 1 }))
      const topSkill = Object.keys(shared).sort((a, b) => shared[b] - shared[a])[0]
      setMatch({ count: matches.length, skill: topSkill, kind: opp })
    })
    return () => { active = false }
  }, [detail, uid])

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(''), 3000) }

  async function deletePost(id, mine) {
    const { error: e } = mine
      ? await supabase.from('team_posts').delete().eq('id', id)
      : await supabase.rpc('admin_delete_team_post', { p_id: id })
    if (e) { console.error(e); return setError('Could not delete the post. Try again.') }
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  async function toggleClosed(post) {
    const { error: e } = await supabase.rpc('set_team_closed', { p_id: post.id, p_closed: !post.closed })
    if (e) { console.error(e); return setError('Could not update the post. Try again.') }
    flash(post.closed ? 'Post reopened.' : 'Post closed.')
    load()
  }

  async function withdraw(postId) {
    const { error: e } = await supabase
      .from('team_applications')
      .delete()
      .eq('team_post_id', postId)
      .eq('applicant_id', uid)
    if (e) { console.error(e); return setError('Could not withdraw. Try again.') }
    flash('Withdrawn.')
    load()
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Services</h1>
          <p className="mt-0.5 text-sm text-muted">Offer a service, or find what you need.</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setPostOpen(true)}>
          <Plus size={16} /> {m.cta}
        </button>
      </div>

      <div role="tablist" aria-label="Services" className="mt-4 inline-flex rounded-lg border border-line p-0.5">
        <button role="tab" aria-selected={tab === 'offer'} className={segCls(tab === 'offer')} onClick={() => switchTab('offer')}>Offering</button>
        <button role="tab" aria-selected={tab === 'request'} className={segCls(tab === 'request')} onClick={() => switchTab('request')}>Looking for</button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {tab === 'offer' ? 'Share a skill or service you can offer other founders.' : 'A service you need, or a teammate / employee to hire.'}
      </p>

      <div className="relative mt-4">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search services" placeholder="Search services, skills, people..."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={filterChip(openOnly)} onClick={() => setOpenOnly((v) => !v)}>Open only</button>
        {tab === 'request' && (
          <>
            <button className={filterChip(payFilter === 'paid')} onClick={() => setPayFilter((v) => (v === 'paid' ? 'all' : 'paid'))}>Paid</button>
            <button className={filterChip(payFilter === 'free')} onClick={() => setPayFilter((v) => (v === 'free' ? 'all' : 'free'))}>Free</button>
          </>
        )}
        {skillFilter && (
          <button className={filterChip(true)} onClick={() => setSkillFilter(null)}>
            Skill: {skillFilter} <X size={11} className="ml-0.5 inline" />
          </button>
        )}
        {hasFilters && (
          <button className="text-xs font-semibold text-muted hover:text-ink" onClick={clearFilters}>Clear</button>
        )}
      </div>

      {notice && (
        <div role="status" className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}

      <div aria-live="polite" className="sr-only">
        {!loading && !error && `${shown.length} ${shown.length === 1 ? 'post' : 'posts'} match`}
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
      ) : shown.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          {hasFilters ? (
            <>
              <p className="font-semibold">Nothing matches these filters.</p>
              <button className="btn-outline mt-3" onClick={clearFilters}>Clear filters</button>
            </>
          ) : debounced ? (
            <p className="font-semibold">Nothing matches this search.</p>
          ) : (
            <>
              <p className="font-semibold">{m.emptyTitle}</p>
              <p className="mt-1 text-sm text-muted">{m.emptyHint}</p>
              <button className="btn-primary mt-4" onClick={() => setPostOpen(true)}>{m.cta}</button>
              {m.crossTab && (
                <button className="mt-3 block w-full text-sm font-semibold text-accent hover:underline" onClick={() => switchTab('offer')}>
                  {m.crossTab}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shown.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`View: ${t.title}`}
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
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {t.kind === 'request' && t.startup && <span className="truncate font-semibold">{t.startup}</span>}
                {t.kind === 'request' && t.paid && (
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 font-bold text-success">
                    <IndianRupee size={11} />{t.budget ? t.budget : 'Paid'}
                  </span>
                )}
                {t.commitment && <span className="truncate">{t.kind === 'offer' ? t.commitment : `Needed by ${t.commitment}`}</span>}
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
                    ? `${Number(t.app_count)} ${Number(t.app_count) === 1 ? meta(t.kind).listOne : meta(t.kind).listMany}`
                    : t.i_applied
                      ? <span className="text-accent">{meta(t.kind).respondPast}</span>
                      : 'View'}
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
          match={match}
          onMatch={() => match && filterBySkill(match.kind, match.skill)}
          onSkillClick={(s) => filterBySkill(detail.kind, s)}
          onClose={() => setDetail(null)}
          onRespond={() => { setRespondTo(detail); setDetail(null) }}
          onWithdraw={() => {
            const d = detail
            setDetail(null)
            setConfirm({
              title: 'Withdraw?',
              message: 'Your response to this post will be removed.',
              confirmLabel: 'Withdraw',
              tone: 'danger',
              onConfirm: async () => { await withdraw(d.id); setConfirm(null) },
            })
          }}
          onEdit={() => { setEditPost(detail); setDetail(null) }}
          onResponders={() => { setRespondersFor(detail); setDetail(null) }}
          onToggleClosed={() => { toggleClosed(detail); setDetail(null) }}
          onDelete={() => {
            const d = detail
            setDetail(null)
            setConfirm({
              title: 'Delete this post?',
              message: 'This permanently removes the post and its responses.',
              confirmLabel: 'Delete',
              tone: 'danger',
              onConfirm: async () => { await deletePost(d.id, d.is_mine); setConfirm(null) },
            })
          }}
        />
      )}

      {postOpen && (
        <PostModal
          kind={tab}
          onClose={() => setPostOpen(false)}
          onSaved={() => { setPostOpen(false); flash(m.postedMsg); load() }}
        />
      )}
      {editPost && (
        <PostModal
          kind={editPost.kind}
          edit={editPost}
          onClose={() => setEditPost(null)}
          onSaved={() => { setEditPost(null); flash(meta(editPost.kind).updatedMsg); load() }}
        />
      )}
      {respondTo && (
        <RespondModal
          post={respondTo}
          onClose={() => setRespondTo(null)}
          onSent={() => { setRespondTo(null); flash('Sent.'); load() }}
        />
      )}
      {respondersFor && (
        <RespondersModal post={respondersFor} onClose={() => setRespondersFor(null)} />
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

const segCls = (active) => `min-h-9 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`
const filterChip = (active) => `inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${active ? 'bg-accent-soft text-accent ring-accent/40' : 'text-muted ring-line hover:text-ink'}`

function DetailModal({ post, isAdmin, match, onClose, onRespond, onWithdraw, onEdit, onResponders, onToggleClosed, onDelete, onMatch, onSkillClick }) {
  const m = meta(post.kind)
  const ageDays = daysSince(post.created_at)
  const oppNoun = match ? (match.kind === 'offer' ? (match.count === 1 ? 'offer' : 'offers') : (match.count === 1 ? 'request' : 'requests')) : ''
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

      {post.kind === 'request' && post.startup && <span className="mt-3 inline-flex w-fit chip">{post.startup}</span>}
      {post.description && (
        <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm text-ink">{post.description}</p>
      )}

      <dl className="mt-4 space-y-1.5 text-sm">
        {post.kind === 'offer' && post.commitment && <Row label="Availability" value={post.commitment} />}
        {post.kind === 'request' && post.commitment && <Row label="Needed by" value={post.commitment} />}
        {post.kind === 'request' && post.paid && <Row label="Paid" value={post.budget ? post.budget : 'Yes'} />}
      </dl>

      {post.skills?.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {post.skills.map((s) => (
              <button key={s} onClick={() => onSkillClick(s)} className="rounded-md bg-page px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line transition-colors hover:text-accent hover:ring-accent/50">{s}</button>
            ))}
          </div>
        </div>
      )}

      {match && match.count > 0 && (
        <button onClick={onMatch} className="mt-4 flex w-full items-center justify-between rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft">
          <span>{match.count} {oppNoun} {match.count === 1 ? 'matches' : 'match'} · {match.skill}</span>
          <ChevronRight size={16} />
        </button>
      )}

      {post.is_mine && !post.closed && ageDays >= 30 && (
        <div className="mt-4 rounded-lg border border-line bg-page px-3 py-2 text-sm text-muted">
          Posted {ageDays} days ago. Still open?{' '}
          <button className="font-semibold text-accent hover:underline" onClick={onToggleClosed}>Close it</button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {post.is_mine ? (
          <>
            <button className="btn-outline" onClick={onResponders}>{m.listLabel} ({Number(post.app_count)})</button>
            <button className="btn-outline" onClick={onEdit}>Edit</button>
            <button className="btn-outline" onClick={onToggleClosed}>{post.closed ? 'Reopen' : 'Close'}</button>
          </>
        ) : post.i_applied ? (
          <button onClick={onWithdraw} className="btn inline-flex items-center border border-down/40 px-4 py-2 text-sm text-down transition-colors hover:bg-down/10">
            Withdraw
          </button>
        ) : post.closed ? (
          <span className="text-sm font-semibold text-down">This post is closed.</span>
        ) : (
          <button className="btn-primary" onClick={onRespond}>{m.respond}</button>
        )}
        {isAdmin && !post.is_mine && (
          <>
            <button className="btn-outline" onClick={onResponders}>{m.listLabel} ({Number(post.app_count)})</button>
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

// Post form. `kind` decides which fields show: an offer is a service you give (availability),
// a request is a service you need (needed-by, optional startup, optional paid gig).
function PostModal({ kind, edit, onClose, onSaved }) {
  const { session } = useAuth()
  const isOffer = kind === 'offer'
  const m = meta(kind)
  const [f, setF] = useState({
    title: edit?.title || '',
    startup: edit?.startup || '',
    description: edit?.description || '',
    commitment: edit?.commitment || '',
    paid: edit?.paid || false,
    budget: edit?.budget || '',
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
    if (!f.title.trim()) errs.title = isOffer ? 'Name the service you offer.' : 'Say what you need.'
    if (!f.description.trim()) errs.description = 'Add a description.'
    if (errs.title || errs.description) {
      setFieldErr(errs)
      ;(errs.title ? titleRef : descRef).current?.focus()
      return
    }
    setFieldErr({})
    setBusy(true)
    const paid = isOffer ? false : f.paid
    const payload = {
      kind,
      title: f.title.trim(),
      startup: isOffer ? '' : f.startup.trim(),
      description: f.description.trim(),
      looking_for: '',
      commitment: f.commitment.trim(),
      stage: '',
      paid,
      budget: paid ? f.budget.trim() : '',
      skills,
    }
    const { error: e } = edit
      ? await supabase.from('team_posts').update(payload).eq('id', edit.id)
      : await supabase.from('team_posts').insert({ ...payload, author_id: session.user.id })
    setBusy(false)
    if (e) { console.error(e); return setError('Could not save. Check your connection and try again.') }
    onSaved()
  }

  return (
    <>
    <Shell title={edit ? (isOffer ? 'Edit offer' : 'Edit request') : m.cta} onClose={requestClose}>
      {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <L label={isOffer ? 'Service *' : 'What you need *'} error={fieldErr.title}>
            <input ref={titleRef} className="input" aria-invalid={!!fieldErr.title || undefined} maxLength={200} value={f.title} onChange={set('title')} placeholder={isOffer ? 'Logo & brand design' : 'A logo, or a developer to hire'} />
          </L>
          <L label={isOffer ? 'Availability' : 'Needed by'}>
            <input className="input" maxLength={120} value={f.commitment} onChange={set('commitment')} placeholder={isOffer ? 'Evenings, next 2 weeks' : 'Within 2 weeks'} />
          </L>
        </div>
        <L label="Description *" error={fieldErr.description}>
          <textarea ref={descRef} className="input min-h-[70px] resize-y" aria-invalid={!!fieldErr.description || undefined} maxLength={1200} value={f.description} onChange={set('description')} placeholder={isOffer ? 'What you offer, your experience, links' : 'What you need and any context'} />
        </L>
        {!isOffer && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <L label="Startup"><input className="input" maxLength={200} value={f.startup} onChange={set('startup')} placeholder="FarmSense" /></L>
            <L label="Paid gig?">
              <label className="flex min-h-[42px] cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={f.paid} onChange={(e) => setF((p) => ({ ...p, paid: e.target.checked }))} />
                <span className="text-sm font-semibold">This is a paid gig</span>
              </label>
            </L>
          </div>
        )}
        {!isOffer && f.paid && (
          <L label="Budget (optional)">
            <input className="input" maxLength={120} value={f.budget} onChange={set('budget')} placeholder="₹5000 or negotiable" />
          </L>
        )}
        <L label={`Skills (${skills.length}/${MAX_SKILLS})`}>
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
        title={edit ? 'Discard your changes?' : 'Discard this post?'}
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

function RespondModal({ post, onClose, onSent }) {
  const m = meta(post.kind)
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
    if (e) { console.error(e); return setError(e.message === 'already applied' ? 'You already responded to this.' : 'Could not send. Check your connection and try again.') }
    onSent()
  }

  return (
    <>
    <Shell title={`${m.respond}: ${post.title}`} onClose={requestClose}>
      <p className="mt-3 text-sm text-muted">
        Reaching out to <span className="font-bold text-ink">{post.author_name}</span>
        {post.kind === 'request' && post.startup ? <> for <span className="font-bold text-ink">{post.startup}</span></> : null}. They will see your message and the contact info you share here. Your account email stays private.
      </p>
      {error && <div role="alert" className="mt-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Message</span>
        <textarea
          className="input min-h-[100px] resize-y" maxLength={2000} value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={post.kind === 'offer' ? 'What you need, timing, links...' : "Why you're a fit, links, availability..."}
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Contact info *</span>
        <input
          className="input" maxLength={200} value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Email, phone, or @handle they can reach you on"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={send} disabled={busy}>
          {busy ? 'Sending...' : 'Send'}
        </button>
      </div>
    </Shell>
    {confirmDiscard && (
      <ConfirmModal
        title="Discard this?"
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

function RespondersModal({ post, onClose }) {
  const m = meta(post.kind)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('team_applicants', { p_post: post.id }).then(({ data, error: e }) => {
      if (e) { console.error(e); setError('Could not load. Try again.') } else setRows(data || [])
    })
  }, [post.id])

  return (
    <Shell title={`${m.listLabel}: ${post.title}`} onClose={onClose}>
      {error ? (
        <p className="mt-4 text-sm text-down">{GENERIC_ERR}</p>
      ) : rows === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted"><Spinner /> Loading...</div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No {m.listMany} yet.</p>
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
