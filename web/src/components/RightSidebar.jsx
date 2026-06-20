import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { typeDot } from '../lib/calendar'

export default function RightSidebar() {
  const [tags, setTags] = useState([])
  const [events, setEvents] = useState([])

  useEffect(() => {
    let active = true
    supabase.rpc('trending_tags', { p_days: 7, p_limit: 6 }).then(({ data }) => {
      if (active) setTags(data || [])
    })
    supabase
      .from('events')
      .select('id, title, type, starts_at')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(5)
      .then(({ data }) => { if (active) setEvents(data || []) })
    return () => { active = false }
  }, [])

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-accent" />
          <h3 className="font-bold">Trending Topics</h3>
        </div>
        {tags.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No tags yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tags.map((t) => (
              <li key={t.name}>
                <Link
                  to={`/?tag=${encodeURIComponent(t.name)}`}
                  className="flex items-center justify-between gap-2 hover:underline"
                >
                  <span className="truncate text-sm font-semibold text-accent">#{t.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {Number(t.cnt)} {Number(t.cnt) === 1 ? 'post' : 'posts'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-accent" />
          <h3 className="font-bold">Upcoming Events</h3>
        </div>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {events.map((ev) => (
              <li key={ev.id}>
                <Link to="/calendar" className="flex items-start gap-2 hover:underline">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${typeDot(ev.type)}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{ev.title}</span>
                    <span className="block text-xs text-muted">
                      {new Date(ev.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      {' · '}
                      {new Date(ev.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/calendar" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">View calendar</Link>
      </section>
    </div>
  )
}
