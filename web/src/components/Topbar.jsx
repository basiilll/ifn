import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Calendar, Menu, User, Settings as SettingsIcon, LogOut, CheckCircle2, BellRing, Inbox } from 'lucide-react'
import Logo from './Logo'
import { supabase } from '../lib/supabase'
import { typeDot } from '../lib/calendar'
import { NOTIF_TEXT } from '../lib/pipeline'
import { useAuth } from '../lib/AuthProvider'

export default function Topbar({ onMenu }) {
  const navigate = useNavigate()
  const { session, isMentor } = useAuth()
  const uid = session?.user?.id
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [soon, setSoon] = useState([])
  const [notifs, setNotifs] = useState([])
  const [unread, setUnread] = useState(0)
  
  // MERGED: Tab tracking state from your old notifications page
  const [activeFilter, setActiveFilter] = useState('action') // 'action' | 'all' | 'mine'

  const profRef = useRef(null)
  const bellRef = useRef(null)

  useEffect(() => {
    function onDoc(e) {
      if (profRef.current && !profRef.current.contains(e.target)) setMenuOpen(false)
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const now = new Date()
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    supabase
      .from('events')
      .select('id, title, type, starts_at')
      .gte('starts_at', now.toISOString())
      .lte('starts_at', week.toISOString())
      .order('starts_at')
      .limit(4) 
      .then(({ data }) => setSoon(data || []))
    supabase.rpc('notifications_unread_count').then(({ data }) => setUnread(Number(data) || 0))
  }, [])

  async function openBell() {
    const next = !bellOpen
    setBellOpen(next)
    if (!next) return
    const { data } = await supabase.rpc('my_notifications', { p_limit: 40 })
    setNotifs(data || [])
    if (unread > 0) {
      await supabase.rpc('mark_notifications_read')
      setUnread(0)
    }
  }

  function openNotif(n) {
    setBellOpen(false)
    if (n.idea_id) return navigate(`/pipeline/${n.idea_id}`)
    if (['service_response', 'application_withdrawn', 'application_deleted'].includes(n.kind)) return navigate('/services')
    if (['problem_solution_received', 'solution_reviewed'].includes(n.kind)) return navigate('/problems')
    if (n.kind === 'registration_request') return navigate('/admin')
    navigate('/notifications')
  }

  // The action/all/mine tabs are a mentor+ tool; regular members just see their full list.
  const effectiveFilter = isMentor ? activeFilter : 'all'
  const filteredNotifs = notifs.filter(n => {
    if (effectiveFilter === 'action') return !n.read_at && (n.kind?.includes('action') || n.kind?.includes('review'))
    if (effectiveFilter === 'mine') return n.actor_id === uid
    return true // 'all'
  })

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <button onClick={onMenu} className="-ml-1 rounded-full p-2 text-muted hover:bg-black/5 hover:text-ink lg:hidden" aria-label="Open navigation">
          <Menu size={22} />
        </button>
        <Link to="/" aria-label="Home" className="flex items-center gap-2.5">
          <Logo className="h-8 w-auto" />
        </Link>

        <div className="ml-auto flex items-center gap-1">
          {/* calendar — hidden on mobile where it lives in the sidenav drawer */}
          <Link to="/calendar" className="hidden lg:flex rounded-full p-2 text-muted hover:bg-black/5 hover:text-ink" aria-label="Calendar">
            <Calendar size={20} />
          </Link>
          <div className="relative" ref={bellRef}>
            <button onClick={openBell} className="relative rounded-full p-2 text-muted hover:bg-black/5 hover:text-ink" aria-label="Notifications">
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-onaccent ring-2 ring-card">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 mt-2 w-96 overflow-hidden rounded-xl border border-line bg-card shadow-pop z-50">
                <div className="border-b border-line px-4 py-2.5 flex items-center justify-between bg-page">
                  <span className="text-xs font-bold uppercase tracking-wide text-ink">Notifications</span>
                </div>

                {/* Tab bar: mentor+ only; members just see their own list */}
                {isMentor && (
                <div role="tablist" aria-label="Notification filter" className="flex gap-1 p-2 border-b border-line bg-page/50">
                  <button
                    role="tab"
                    aria-selected={activeFilter === 'action'}
                    onClick={() => setActiveFilter('action')}
                    className={`flex-1 text-center py-1 text-xs font-semibold rounded-md transition-colors ${activeFilter === 'action' ? 'bg-accent-soft text-accent border border-accent/20' : 'text-muted hover:bg-black/5'}`}
                  >
                    Needs action
                  </button>
                  <button
                    role="tab"
                    aria-selected={activeFilter === 'all'}
                    onClick={() => setActiveFilter('all')}
                    className={`flex-1 text-center py-1 text-xs font-semibold rounded-md transition-colors ${activeFilter === 'all' ? 'bg-accent-soft text-accent border border-accent/20' : 'text-muted hover:bg-black/5'}`}
                  >
                    All activity
                  </button>
                  <button
                    role="tab"
                    aria-selected={activeFilter === 'mine'}
                    onClick={() => setActiveFilter('mine')}
                    className={`flex-1 text-center py-1 text-xs font-semibold rounded-md transition-colors ${activeFilter === 'mine' ? 'bg-accent-soft text-accent border border-accent/20' : 'text-muted hover:bg-black/5'}`}
                  >
                    My activity
                  </button>
                </div>
                )}

                {/* MERGED: Core list display view tracking filter hooks */}
                <div className="max-h-80 overflow-y-auto divide-y divide-line/60">
                  {filteredNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-1.5">
                      <CheckCircle2 size={24} className="text-muted/60" />
                      <p className="text-sm font-medium text-ink">Nothing needs you.</p>
                      <p className="text-xs text-muted max-w-[240px]">Submissions and unassigned items match this filter.</p>
                    </div>
                  ) : (
                    <ul className="py-1">
                      {filteredNotifs.map((n) => (
                        <li key={n.id}>
                          <button onClick={() => openNotif(n)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-black/5 transition-colors">
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-line' : 'bg-accent'}`} />
                            <div className="min-w-0 flex-1">
                              <span className={`block text-xs leading-tight ${n.read_at ? 'text-ink/80' : 'font-semibold text-ink'}`}>
                                {NOTIF_TEXT[n.kind] || n.kind}
                              </span>
                              <span className="block truncate text-[11px] text-muted mt-0.5">
                                {n.idea_title || n.payload?.title || ''}{n.actor_name ? ` · ${n.actor_name}` : ''}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Calendar view logic subset container */}
                  <div className="bg-page/40 border-t border-line px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">Upcoming Events</div>
                  {soon.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-muted italic">No events scheduled this week.</div>
                  ) : (
                    <ul className="py-0.5 bg-page/20 divide-y divide-line/30">
                      {soon.map((ev) => (
                        <li key={ev.id}>
                          <button onClick={() => { setBellOpen(false); navigate('/calendar') }} className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-black/5">
                            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${typeDot(ev.type)}`} />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-ink">{ev.title}</span>
                              <span className="block text-[10px] text-muted mt-0.5">
                                {new Date(ev.starts_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(ev.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={() => { setBellOpen(false); navigate('/notifications') }}
                  className="block w-full border-t border-line px-4 py-2.5 text-center text-xs font-bold text-accent hover:bg-black/5"
                >
                  Expand notifications
                </button>
              </div>
            )}
          </div>

          {/* Account Profile Menu Shell */}
          <div className="relative" ref={profRef}>
            <button onClick={() => setMenuOpen((v) => !v)} className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent transition hover:ring-2 hover:ring-accent/40" aria-label="Account">
              <User size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-pop z-50">
                <MenuItem icon={User} label="View profile" onClick={() => { setMenuOpen(false); navigate('/profile') }} />
                <MenuItem icon={SettingsIcon} label="Settings" onClick={() => { setMenuOpen(false); navigate('/settings') }} />
                <div className="my-1 border-t border-line" />
                <MenuItem icon={LogOut} label="Log out" onClick={() => supabase.auth.signOut()} />
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function MenuItem({ icon: Ic, label, onClick }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-black/5">
      <Ic size={16} className="text-muted" />
      {label}
    </button>
  )
}