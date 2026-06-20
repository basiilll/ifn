import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowBigUp, ArrowBigDown, MessageCircle, Pin } from 'lucide-react'
import PollBlock from './PollBlock'
import AuthorLink from './AuthorLink'
import { timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

export default function PostCard({ post }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.user?.id
  const anon = !post.author_name
  const [score, setScore] = useState(Number(post.score) || 0)
  const [myVote, setMyVote] = useState(post.my_vote ?? 0)
  const [voting, setVoting] = useState(false)
  const [voteError, setVoteError] = useState(false)

  const open = () => navigate(`/post/${post.id}`)
  const stop = (e) => e.stopPropagation()

  async function vote(e, v) {
    e.stopPropagation()
    if (voting || !uid) return
    const prevScore = score
    const prevVote = myVote
    const nextVote = myVote === v ? 0 : v // click same arrow again = remove vote
    setMyVote(nextVote)
    setScore(score + (nextVote - myVote))
    setVoting(true)
    try {
      if (nextVote === 0) {
        await supabase.from('post_votes').delete().eq('post_id', post.id).eq('user_id', uid)
      } else {
        await supabase.from('post_votes').upsert({ post_id: post.id, user_id: uid, value: nextVote })
      }
    } catch {
      setMyVote(prevVote)
      setScore(prevScore)
      setVoteError(true)
      setTimeout(() => setVoteError(false), 3000)
    } finally {
      setVoting(false)
    }
  }

  return (
    <article
      onClick={open}
      className="card cursor-pointer p-5 transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop"
    >
      <header className="flex items-center gap-2">
        <AuthorLink id={post.author_id} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">
          {anon ? '?' : post.author_name.charAt(0).toUpperCase()}
        </AuthorLink>
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
            {timeAgo(post.created_at)}
          </div>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {post.badges?.includes('Success') && (
            <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">#Success</span>
          )}
          {post.kind === 'poll' && (
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Poll</span>
          )}
        </span>
      </header>

      <h3 className="mt-3 break-words text-base font-bold">
        <Link
          to={`/post/${post.id}`}
          onClick={stop}
          className="rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {post.title}
        </Link>
      </h3>

      {/* compact: clamp to 4 lines; full text lives on the detail page */}
      {post.problem && (
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm text-ink">{post.problem}</p>
      )}

      {post.kind === 'poll' && <PollBlock postId={post.id} />}

      {post.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <span key={t} className="chip">#{t}</span>
          ))}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-2">
        <div onClick={stop} className="inline-flex items-center gap-0.5 rounded-lg bg-page px-1 py-0.5">
          <button
            onClick={(e) => vote(e, 1)}
            aria-label="Upvote"
            className={`rounded-full p-1.5 transition-colors hover:bg-black/5 ${myVote === 1 ? 'text-accent' : 'text-muted'}`}
          >
            <ArrowBigUp size={20} fill={myVote === 1 ? 'currentColor' : 'none'} />
          </button>
          <span
            className={`min-w-[2ch] text-center text-sm font-bold ${
              myVote > 0 ? 'text-accent' : myVote < 0 ? 'text-down' : 'text-ink'
            }`}
          >
            {score}
          </span>
          <button
            onClick={(e) => vote(e, -1)}
            aria-label="Downvote"
            className={`rounded-full p-1.5 transition-colors hover:bg-black/5 ${myVote === -1 ? 'text-down' : 'text-muted'}`}
          >
            <ArrowBigDown size={20} fill={myVote === -1 ? 'currentColor' : 'none'} />
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-page px-3 py-2 text-sm font-semibold text-muted">
          <MessageCircle size={18} /> {post.comment_count ?? 0}
        </span>
        {post.edited && <span className="ml-1 text-xs text-faint">edited</span>}
        {voteError && <span role="alert" className="ml-1 text-xs font-semibold text-down">Vote not saved. Try again.</span>}
      </footer>
    </article>
  )
}
