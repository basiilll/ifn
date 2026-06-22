import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X, ArrowUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/errors'
import PostCard from '../components/PostCard'
import PostCardSkeleton from '../components/PostCardSkeleton'
import CreatePostModal from '../components/CreatePostModal'
import CreatePollModal from '../components/CreatePollModal'
import FirstRunBanner from '../components/FirstRunBanner'
import { useAuth } from '../lib/AuthProvider'
import { usePageTitle } from '../lib/usePageTitle'

const PAGE = 20
const SORTS = [
  { s: 'hot', label: 'Hot' },
  { s: 'new', label: 'New' },
  { s: 'top', label: 'Top' },
]
// time window for the Top sort (null = all time)
const TOP_WINDOWS = [
  { w: 'today', label: 'Today', days: 1 },
  { w: 'week', label: 'Week', days: 7 },
  { w: 'all', label: 'All time', days: null },
]

const normTag = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, '')

// Split the search box into free text + committed #tags. The token currently being typed
// (last token with no trailing space) is "in progress": a #word there drives autocomplete but
// is not yet a filter; a plain word there still filters text live.
function parseQuery(q) {
  const trailing = /\s$/.test(q)
  const toks = q.trim().split(/\s+/).filter(Boolean)
  const inProgress = trailing ? '' : toks[toks.length - 1] || ''
  const committed = trailing ? toks : toks.slice(0, -1)
  const tags = []
  const words = []
  for (const tok of committed) {
    if (tok.startsWith('#')) {
      const n = normTag(tok.slice(1))
      if (n && !tags.includes(n)) tags.push(n)
    } else {
      words.push(tok)
    }
  }
  if (inProgress && !inProgress.startsWith('#')) words.push(inProgress)
  const typingTag = inProgress.startsWith('#')
  return { text: words.join(' '), tags, typingTag, tagToken: typingTag ? normTag(inProgress.slice(1)) : '' }
}

export default function Feed() {
  usePageTitle('Feed')
  const { isAdmin, restricted } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [feedLocked, setFeedLocked] = useState(false)

  const [sort, setSort] = useState('hot')
  const [topWindow, setTopWindow] = useState('week') // window for the Top sort
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ text: '', tags: [] })

  const [availableTags, setAvailableTags] = useState([])

  const [posts, setPosts] = useState([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createPollOpen, setCreatePollOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const [newestAt, setNewestAt] = useState(null)
  const [newCount, setNewCount] = useState(0)

  // tags that actually have posts (for # suggestions)
  useEffect(() => {
    supabase.rpc('feed_tags').then(({ data }) => setAvailableTags(data || []))
  }, [])

  // global feed lock (admins can still post)
  useEffect(() => {
    supabase.from('app_settings').select('feed_locked').single().then(({ data }) => setFeedLocked(!!data?.feed_locked))
  }, [])

  // a trending click arrives as /?tag=name; seed the search box with #name, then clear the URL
  useEffect(() => {
    const t = searchParams.get('tag')
    if (!t) return
    const tok = `#${normTag(t)}`
    setQ((prev) => (prev.includes(tok) ? prev : `${prev ? prev.trim() + ' ' : ''}${tok} `))
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  // live view of the box (suggestions) + debounced view (the actual query)
  const live = parseQuery(q)
  useEffect(() => {
    const id = setTimeout(() => {
      const { text, tags } = parseQuery(q)
      setFilters({ text, tags })
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const suggestions = live.typingTag
    ? availableTags.filter((t) => t.name.startsWith(live.tagToken)).slice(0, 8)
    : []

  const tagsKey = filters.tags.join(',')
  const fetchPage = useCallback(
    async (off, replace) => {
      const { data, error: e } = await supabase.rpc('feed_posts', {
        p_kind: null,
        p_search: filters.text || null,
        p_tags: filters.tags.length ? filters.tags : null,
        p_sort: sort,
        p_limit: PAGE,
        p_offset: off,
        p_top_days: sort === 'top' ? (TOP_WINDOWS.find((t) => t.w === topWindow)?.days ?? null) : null,
      })
      if (e) { console.error('feed_posts failed:', e); setError(errMessage(e, 'Could not load the feed. Check your connection and try again.')); return 0 }
      setError('')
      const rows = data || []
      setPosts((prev) => (replace ? rows : [...prev, ...rows]))
      setHasMore(rows.length === PAGE)
      if (replace) {
        // baseline = newest post actually shown (rows[0] is not newest under Hot/Top sort)
        const newest = rows.reduce(
          (m, r) => (r.created_at > m ? r.created_at : m),
          rows[0]?.created_at || new Date().toISOString(),
        )
        setNewestAt(newest)
        setNewCount(0)
      }
      return rows.length
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sort, topWindow, filters.text, tagsKey],
  )

  // reload from the top when filters/sort/search change
  useEffect(() => {
    setLoading(true)
    fetchPage(0, true).then((count) => {
      setOffset(count)
      setLoading(false)
    })
  }, [fetchPage])

  // poll for newer posts (banner, no auto-insert); skip hidden tabs, give up after 3 straight failures
  useEffect(() => {
    if (!newestAt) return
    let fails = 0
    const id = setInterval(() => {
      if (document.hidden) return
      supabase.rpc('posts_since', { p_since: newestAt }).then(({ data, error: e }) => {
        if (e) {
          fails += 1
          if (fails >= 3) clearInterval(id)
          return
        }
        fails = 0
        if (data != null) setNewCount(Number(data))
      })
    }, 30000)
    return () => clearInterval(id)
  }, [newestAt])

  async function loadMore() {
    setLoadingMore(true)
    const count = await fetchPage(offset, false)
    setOffset((o) => o + count)
    setLoadingMore(false)
  }

  // infinite scroll: sentinel near the list bottom auto-loads the next page
  const sentinelRef = useRef(null)
  const loadMoreRef = useRef(() => {})
  loadMoreRef.current = () => {
    if (loading || loadingMore || !hasMore || error) return
    loadMore()
  }
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreRef.current() },
      { rootMargin: '600px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // back-to-top button after scrolling down a few screens
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 800)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function reload() {
    setLoading(true)
    fetchPage(0, true).then((count) => {
      setOffset(count)
      setLoading(false)
    })
  }

  // commit the in-progress #token (or a picked suggestion) as a tag in the box
  function pickTag(name) {
    setQ((prev) => {
      const trailing = /\s$/.test(prev)
      const toks = prev.trim().split(/\s+/).filter(Boolean)
      if (!trailing && toks.length) toks.pop() // drop the in-progress token
      const tok = `#${name}`
      if (!toks.includes(tok)) toks.push(tok)
      return toks.join(' ') + ' '
    })
  }

  function removeTag(name) {
    setQ((prev) =>
      prev
        .split(/\s+/)
        .filter(Boolean)
        .filter((tok) => !(tok.startsWith('#') && normTag(tok.slice(1)) === name))
        .join(' '),
    )
  }

  const hasFilter = filters.text || filters.tags.length > 0

  return (
    <div>
      <h1 className="sr-only">Feed</h1>
      <FirstRunBanner />
      {/* search + create */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="input"
            aria-label="Search posts" placeholder="Search posts, add #tags to filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && live.typingTag) {
                e.preventDefault()
                if (live.tagToken) pickTag(live.tagToken)
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
              {suggestions.map((t) => (
                <button
                  key={t.name}
                  onClick={() => pickTag(t.name)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-accent hover:bg-black/5"
                >
                  <span>#{t.name}</span>
                  <span className="text-xs text-muted">{Number(t.cnt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {isAdmin && !restricted && (
          <button className="btn-outline shrink-0" onClick={() => setCreatePollOpen(true)}>Create poll</button>
        )}
        {!restricted && (
          feedLocked && !isAdmin ? (
            <button type="button" disabled aria-disabled="true" title="Posting is paused by an admin" className="btn-primary shrink-0 cursor-not-allowed opacity-50">Create post</button>
          ) : (
            <button className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>Create post</button>
          )
        )}
      </div>

      {feedLocked && (
        <div role="status" className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warnink">
          {isAdmin ? 'Posting is closed for members. You can still post as an admin.' : 'Posting is currently closed by an admin.'}
        </div>
      )}

      {/* controls: sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* sort: segmented control, all options visible + self-labeling */}
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Sort posts">
          {SORTS.map((o) => (
            <button
              key={o.s}
              role="radio"
              aria-checked={sort === o.s}
              onClick={() => setSort(o.s)}
              className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                sort === o.s ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Top needs a window, else it silently rots into all-time */}
        {sort === 'top' && (
          <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Top window">
            {TOP_WINDOWS.map((t) => (
              <button
                key={t.w}
                role="radio"
                aria-checked={topWindow === t.w}
                onClick={() => setTopWindow(t.w)}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  topWindow === t.w ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* active supertag filters */}
      {filters.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {filters.tags.map((t) => (
            <span key={t} className="chip">
              #{t}
              <button
                onClick={() => removeTag(t)}
                aria-label={`Remove ${t}`}
                className="relative inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 before:absolute before:left-1/2 before:top-1/2 before:h-9 before:w-9 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
              ><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {/* new posts banner */}
      {newCount > 0 && (
        <button
          onClick={reload}
          className="mb-4 w-full rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent hover:underline"
        >
          {newCount} new {newCount === 1 ? 'post' : 'posts'}, tap to refresh
        </button>
      )}

      {notice && (
        <div role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}

      {loading ? (
        <div className="space-y-4">
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-down">Could not load the feed. Check your connection and retry.</p>
          <button className="btn-outline mt-3" onClick={reload}>Retry</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">No posts {hasFilter ? 'match this filter' : 'yet'}.</p>
          {hasFilter ? (
            <button className="btn-outline mt-3" onClick={() => setQ('')}>Clear filter</button>
          ) : (
            <button className="btn-primary mt-4" onClick={() => setCreateOpen(true)}>Create post</button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
          {loadingMore && (
            <div className="mt-4">
              <PostCardSkeleton />
            </div>
          )}
        </>
      )}

      {/* infinite-scroll sentinel (observed once; guards live in loadMoreRef) */}
      <div ref={sentinelRef} aria-hidden className="h-px" />

      {/* back to top */}
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink shadow-pop transition-colors hover:border-accent"
        >
          <ArrowUp size={16} /> Back to top
        </button>
      )}

      <CreatePostModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(status) => {
          setCreateOpen(false)
          setNotice(status === 'draft' ? 'Saved as draft.' : 'Posted.')
          reload()
          supabase.rpc('feed_tags').then(({ data }) => setAvailableTags(data || []))
          setTimeout(() => setNotice(''), 3000)
        }}
      />

      <CreatePollModal
        open={createPollOpen}
        onClose={() => setCreatePollOpen(false)}
        onCreated={() => {
          setCreatePollOpen(false)
          setNotice('Poll posted.')
          reload()
          setTimeout(() => setNotice(''), 3000)
        }}
      />
    </div>
  )
}
