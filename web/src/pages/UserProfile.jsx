import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft, Mail, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { linkedinUrl } from '../lib/linkedin'
import MemberTypeBadge from '../components/MemberTypeBadge'
import PostCard from '../components/PostCard'
import PostCardSkeleton from '../components/PostCardSkeleton'

export default function UserProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(undefined) // undefined = loading, null = not found
  const [posts, setPosts] = useState(null)

  const load = useCallback(async () => {
    setProfile(undefined); setPosts(null)
    const [pr, ps] = await Promise.all([
      supabase.rpc('public_profile', { p_user: id }),
      supabase.rpc('feed_posts', { p_author: id, p_sort: 'new', p_limit: 50 }),
    ])
    setProfile(pr.error ? null : (pr.data?.[0] || null))
    setPosts(ps.error ? [] : (ps.data || []))
  }, [id])
  useEffect(() => { load() }, [load])

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/directory')
  }

  if (profile === undefined) {
    return (
      <div className="max-w-2xl">
        <div className="card animate-pulse p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-line" />
            <div className="space-y-2">
              <div className="h-4 w-40 rounded bg-line" />
              <div className="h-3 w-28 rounded bg-line" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-2xl">
        <button onClick={goBack} className="mb-4 -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="card p-8 text-center">
          <p className="font-semibold">Member not found.</p>
          <p className="mt-1 text-sm text-muted">This profile doesn&rsquo;t exist or was removed.</p>
        </div>
      </div>
    )
  }

  const chips = [profile.region, profile.sector, profile.domain].filter(Boolean)
  return (
    <div className="max-w-2xl">
      <button onClick={goBack} className="mb-4 -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent-soft text-2xl font-bold text-accent">
            {(profile.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold">{profile.name || 'Unnamed'}</h1>
              <MemberTypeBadge type={profile.member_type} />
              {profile.incubation_interest && (
                <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">Open to incubation</span>
              )}
            </div>
            {profile.startup && <p className="mt-0.5 text-sm font-semibold text-muted">{profile.startup}</p>}
            {profile.bio && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{profile.bio}</p>}
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => <span key={c} className="chip">{c}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {profile.is_self ? (
            <Link to="/profile" className="btn-outline inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Pencil size={14} /> Edit profile</Link>
          ) : (
            profile.email && (
              <a href={`mailto:${profile.email}`} className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
                <Mail size={14} /> Email
              </a>
            )
          )}
          {linkedinUrl(profile.linkedin) && (
            <a href={linkedinUrl(profile.linkedin)} target="_blank" rel="noopener noreferrer" className="btn-outline px-3 py-2 text-sm">LinkedIn</a>
          )}
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-sm font-bold">{profile.is_self ? 'Your posts' : 'Posts'}</h2>
      {posts === null ? (
        <div className="space-y-4"><PostCardSkeleton /><PostCardSkeleton /></div>
      ) : posts.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">No public posts yet.</div>
      ) : (
        <div className="space-y-4">
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
      )}

    </div>
  )
}
