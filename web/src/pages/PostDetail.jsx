import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowBigUp, ArrowBigDown, MessageCircle, MoreHorizontal, Pin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import AuthorLink from '../components/AuthorLink'
import Dropdown, { MenuItem } from '../components/Dropdown'
import PostDetailSkeleton from '../components/PostDetailSkeleton'
import CreatePostModal from '../components/CreatePostModal'
import ConfirmModal from '../components/ConfirmModal'
import PollBlock from '../components/PollBlock'
import { timeAgo } from '../lib/format'
import { errMessage } from '../lib/errors'

const CSORTS = [
  { s: 'new', label: 'Newest' },
  { s: 'old', label: 'Oldest' },
]
const GENERIC_ERR = 'Something went wrong. Please try again.'

// kebab "..." menu with outside-click close; children is a render fn receiving close().
function Kebab({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
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
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-full p-1.5 text-muted transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[160px] rounded-xl border border-line bg-card p-1 shadow-pop">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, isAdmin } = useAuth()
  const uid = session?.user?.id

  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [commentOpen, setCommentOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [updateBody, setUpdateBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [csort, setCsort] = useState('new')
  // pending destructive action awaiting confirmation: { title, message, run }
  const [confirm, setConfirm] = useState(null)

  // post vote state (optimistic, same model as PostCard)
  const [score, setScore] = useState(0)
  const [myVote, setMyVote] = useState(0)
  const [voting, setVoting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [d, c, s] = await Promise.all([
        supabase.rpc('post_detail', { p_id: id }),
        supabase.rpc('post_comments', { p_id: id }),
        supabase.rpc('post_subthreads', { p_id: id }),
      ])
      if (d.error) throw d.error
      const p = d.data?.[0] || null
      setPost(p)
      setScore(Number(p?.score) || 0)
      setMyVote(p?.my_vote ?? 0)
      setComments(c.data || [])
      setUpdates(s.data || [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function vote(v) {
    if (voting || !uid) return
    const prevScore = score
    const prevVote = myVote
    const nextVote = myVote === v ? 0 : v
    setMyVote(nextVote)
    setScore(score + (nextVote - myVote))
    setVoting(true)
    try {
      if (nextVote === 0) {
        await supabase.from('post_votes').delete().eq('post_id', id).eq('user_id', uid)
      } else {
        await supabase.from('post_votes').upsert({ post_id: id, user_id: uid, value: nextVote })
      }
    } catch {
      setMyVote(prevVote)
      setScore(prevScore)
      setActionError('Your vote was not saved. Try again.')
    } finally {
      setVoting(false)
    }
  }

  async function addComment(e) {
    e.preventDefault()
    const body = commentBody.trim()
    if (!body) return
    setBusy(true)
    const { error } = await supabase.from('comments').insert({ post_id: id, author_id: uid, body })
    setBusy(false)
    if (error) { console.error(error); return setActionError(errMessage(error, 'Could not post your comment. Check your connection and try again.')) }
    setActionError('')
    setCommentBody('')
    setCommentOpen(false)
    const { data } = await supabase.rpc('post_comments', { p_id: id })
    setComments(data || [])
  }

  function confirmDeleteComment(cid, mine) {
    setConfirm({
      title: 'Delete comment?',
      message: 'This comment will be permanently removed. This cannot be undone.',
      run: () => deleteComment(cid, mine),
    })
  }

  async function deleteComment(cid, mine) {
    // own comments delete via RLS; others (admin moderation) via the admin RPC
    const { error } = mine
      ? await supabase.from('comments').delete().eq('id', cid)
      : await supabase.rpc('admin_delete_comment', { p_id: cid })
    if (error) { console.error(error); return setActionError('Could not delete the comment. Try again.') }
    setComments((prev) => prev.filter((c) => c.id !== cid))
  }

  async function addUpdate(e) {
    e.preventDefault()
    const body = updateBody.trim()
    if (!body) return
    setBusy(true)
    const { error } = await supabase.from('sub_threads').insert({ post_id: id, author_id: uid, body })
    setBusy(false)
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    setActionError('')
    setUpdateBody('')
    const { data } = await supabase.rpc('post_subthreads', { p_id: id })
    setUpdates(data || [])
  }

  function confirmDeleteUpdate(sid) {
    setConfirm({
      title: 'Delete update?',
      message: 'This update will be permanently removed. This cannot be undone.',
      run: () => deleteUpdate(sid),
    })
  }

  async function deleteUpdate(sid) {
    const { error } = await supabase.from('sub_threads').delete().eq('id', sid)
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    setUpdates((prev) => prev.filter((s) => s.id !== sid))
  }

  async function deletePost() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    // own post deletes via RLS; admin moderation uses the admin RPC
    const { error } = post.is_mine
      ? await supabase.from('posts').delete().eq('id', id)
      : await supabase.rpc('admin_delete_post', { p_id: id })
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    navigate('/', { replace: true })
  }

  async function togglePin() {
    const { error } = await supabase.rpc('admin_pin_post', { p_id: id, p_pinned: !post.pinned })
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    setPost((p) => ({ ...p, pinned: !p.pinned }))
  }

  async function toggleCommentsLock() {
    const { error } = await supabase.rpc('admin_set_comments_locked', { p_id: id, p_locked: !post.comments_locked })
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    setPost((p) => ({ ...p, comments_locked: !p.comments_locked }))
  }

  async function requestSuccess() {
    const { error } = await supabase.rpc('request_success', { p_id: id })
    if (error) { console.error(error); return setActionError(GENERIC_ERR) }
    setPost((p) => ({ ...p, success_request: 'pending' }))
  }

  const anon = post && !post.author_name
  const sortedComments = [...comments].sort((a, b) =>
    csort === 'new'
      ? new Date(b.created_at) - new Date(a.created_at)
      : new Date(a.created_at) - new Date(b.created_at),
  )

  return (
    <div className="max-w-2xl">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back
      </button>

      {loading ? (
        <PostDetailSkeleton />
      ) : loadError ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">{GENERIC_ERR}</p>
          <button className="btn-outline mt-3" onClick={load}>Try again</button>
        </div>
      ) : !post ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">This post does not exist or was removed.</p>
          <button className="btn-outline mt-3" onClick={() => navigate('/')}>Back to feed</button>
        </div>
      ) : (
        <>
          {actionError && (
            <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{actionError}</div>
          )}

          {/* post header */}
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">
              {anon ? '?' : post.author_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <AuthorLink id={post.author_id} className="truncate text-sm font-bold">{anon ? 'Anonymous Founder' : post.author_name}</AuthorLink>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted">
                {post.pinned && (
                  <span className="flex items-center gap-0.5 font-semibold text-accent">
                    <Pin size={12} /> Pinned ·
                  </span>
                )}
                {timeAgo(post.created_at)}{post.edited && ' · edited'}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {post.badges?.includes('Success') && (
                <span className="rounded-md bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">#Success</span>
              )}
              {post.kind === 'poll' && (
                <span className="rounded-md bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">Poll</span>
              )}
              {(post.is_mine || isAdmin) && (
                <Kebab>
                  {(close) => (
                    <>
                      {post.is_mine && post.kind !== 'poll' && (
                        <MenuItem onClick={() => { close(); setEditOpen(true) }}>Edit post</MenuItem>
                      )}
                      {post.is_mine && !post.badges?.includes('Success') && post.success_request !== 'pending' && (
                        <MenuItem onClick={() => { close(); requestSuccess() }}>Request #Success</MenuItem>
                      )}
                      {isAdmin && (
                        <MenuItem onClick={() => { close(); togglePin() }}>
                          {post.pinned ? 'Unpin post' : 'Pin post'}
                        </MenuItem>
                      )}
                      {isAdmin && (
                        <MenuItem onClick={() => { close(); toggleCommentsLock() }}>
                          {post.comments_locked ? 'Turn comments on' : 'Turn comments off'}
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => { close(); deletePost() }}>
                        <span className="text-down">Delete post</span>
                      </MenuItem>
                    </>
                  )}
                </Kebab>
              )}
            </div>
          </div>

          {post.is_mine && post.success_request === 'pending' && (
            <div className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
              #Success request pending Admin approval
            </div>
          )}

          {/* title + body */}
          <h1 className="mt-3 break-words text-2xl font-extrabold leading-tight">{post.title}</h1>
          {post.startup && <p className="mt-0.5 break-words text-sm font-semibold text-muted">{post.startup}</p>}
          {post.problem && (
            <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{post.problem}</p>
          )}
          {post.kind === 'poll' && <PollBlock postId={post.id} />}
          {post.kind === 'idea' && post.solution && (
            <div className="mt-3 rounded-lg bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Solution</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{post.solution}</p>
            </div>
          )}

          {post.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {post.tags.map((t) => (
                <span key={t} className="chip">#{t}</span>
              ))}
            </div>
          )}

          {/* action bar */}
          <div className="mt-4 flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-card px-1 py-0.5">
              <button
                onClick={() => vote(1)}
                aria-label="Upvote"
                className={`rounded-full p-1.5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${myVote === 1 ? 'text-accent' : 'text-muted'}`}
              >
                <ArrowBigUp size={20} fill={myVote === 1 ? 'currentColor' : 'none'} />
              </button>
              <span className={`min-w-[2ch] text-center text-sm font-bold ${myVote > 0 ? 'text-accent' : myVote < 0 ? 'text-down' : 'text-ink'}`}>
                {score}
              </span>
              <button
                onClick={() => vote(-1)}
                aria-label="Downvote"
                className={`rounded-full p-1.5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${myVote === -1 ? 'text-down' : 'text-muted'}`}
              >
                <ArrowBigDown size={20} fill={myVote === -1 ? 'currentColor' : 'none'} />
              </button>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-muted">
              <MessageCircle size={18} /> {comments.length}
            </span>
          </div>

          {/* creator updates (unchanged feature) */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold">Updates from the creator</h2>
            {post.is_mine && (
              <form onSubmit={addUpdate} className="mb-3 flex gap-2">
                <input
                  className="input" placeholder="Post an update..." maxLength={2000}
                  aria-label="Post an update"
                  value={updateBody} onChange={(e) => setUpdateBody(e.target.value)}
                />
                <button className="btn-primary shrink-0" disabled={busy}>Add</button>
              </form>
            )}
            {updates.length === 0 ? (
              <p className="text-sm text-muted">No updates yet.</p>
            ) : (
              <ul className="space-y-2">
                {updates.map((u) => (
                  <li key={u.id} className="card p-3">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-ink">{u.author_name || 'Anonymous Founder'}</span>
                      <span>· {timeAgo(u.created_at)}</span>
                      {u.is_mine && (
                        <button
                          type="button"
                          onClick={() => confirmDeleteUpdate(u.id)}
                          aria-label="Delete update"
                          className="ml-auto rounded p-1 text-faint transition-colors hover:text-down focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                        >
                          delete
                        </button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{u.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* comments header + sort */}
          <div className="mb-3 mt-6 flex items-center justify-between">
            <h2 className="text-sm font-bold">{comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}</h2>
            {comments.length > 1 && (
              <Dropdown label={`Sort: ${CSORTS.find((o) => o.s === csort).label}`}>
                {(close) =>
                  CSORTS.map((o) => (
                    <MenuItem key={o.s} active={csort === o.s} onClick={() => { setCsort(o.s); close() }}>
                      {o.label}
                    </MenuItem>
                  ))
                }
              </Dropdown>
            )}
          </div>

          {/* comment composer (under the Comments header); hidden when comments are locked */}
          {post.comments_locked ? (
            <p className="mb-4 rounded-lg bg-page px-3 py-2.5 text-sm text-muted">Comments are turned off for this post.</p>
          ) : (
            <form onSubmit={addComment} className="mb-4">
              <input
                className="input"
                placeholder="Add a comment"
                aria-label="Add a comment"
                maxLength={2000}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onFocus={() => setCommentOpen(true)}
              />
              {(commentOpen || commentBody) && (
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => { setCommentBody(''); setCommentOpen(false) }}
                  >
                    Cancel
                  </button>
                  <button className="btn-primary" disabled={busy || !commentBody.trim()}>Comment</button>
                </div>
              )}
            </form>
          )}

          {/* comments list */}
          {comments.length === 0 ? (
            <p className="py-2 text-sm text-muted">No comments yet. Be the first.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sortedComments.map((c) => (
                <li key={c.id} className="flex gap-2.5 py-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                    {c.author_name ? c.author_name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <AuthorLink id={c.author_id} className="font-semibold text-ink">{c.author_name || 'Member'}</AuthorLink>
                      <span>· {timeAgo(c.created_at)}</span>
                      {(c.is_mine || isAdmin) && (
                        <button
                          type="button"
                          onClick={() => confirmDeleteComment(c.id, c.is_mine)}
                          aria-label="Delete comment"
                          className="ml-auto rounded p-1 text-faint transition-colors hover:text-down focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                        >
                          delete
                        </button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <CreatePostModal
            open={editOpen}
            editPost={{
              id: post.id,
              kind: post.kind,
              title: post.title,
              problem: post.problem,
              solution: post.solution,
              startup: post.startup,
              tags: post.tags || [],
            }}
            onClose={() => setEditOpen(false)}
            onUpdated={() => { setEditOpen(false); load() }}
          />

          {confirm && (
            <ConfirmModal
              title={confirm.title}
              message={confirm.message}
              confirmLabel="Delete"
              tone="danger"
              onConfirm={async () => { await confirm.run(); setConfirm(null) }}
              onClose={() => setConfirm(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
