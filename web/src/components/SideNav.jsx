import { NavLink } from 'react-router-dom'
import { Calendar, ClipboardCheck, FolderHeart, HeartHandshake, Home, LayoutGrid, Puzzle, Shield, Workflow } from 'lucide-react'
import { useAuth } from '../lib/AuthProvider'

const ITEMS = [
  { to: '/', label: 'Feed', icon: Home, end: true, title: 'Community posts and announcements' },
  { to: '/pipeline', label: 'Idea Pipeline', icon: Workflow, title: 'Track your startup through G1–G6 mentor-reviewed gates' },
  { to: '/problem-hub', label: 'Problem Hub', icon: Puzzle, title: 'Post real-world problems; the network proposes solutions' },
  { to: '/services', label: 'Services', icon: HeartHandshake, title: 'Offer or request skills and resources from the network' },
  { to: '/directory', label: 'Directory', icon: LayoutGrid, title: 'Browse and connect with IFN members' },
  { to: '/autopsy-library', label: 'Autopsy Library', icon: FolderHeart, title: 'Post-mortems of failed ideas — what went wrong and why' },
  { to: '/calendar', label: 'Calendar', icon: Calendar, title: 'IFN events and deadlines', mobileOnly: true },
]

const base = 'flex items-center gap-3.5 rounded-lg px-4 py-3 text-base font-semibold transition-colors'

export default function SideNav({ onNavigate }) {
  const { isAdmin, isMentor } = useAuth()
  const isMobile = !!onNavigate
  const items = [
    ...ITEMS.filter((it) => !it.mobileOnly || isMobile),
    ...(isMentor ? [{ to: '/mentor', label: 'Mentor Review', icon: ClipboardCheck, title: 'Review pipeline submissions and manage your assigned ideas' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin Panel', icon: Shield, title: 'Manage members, pipeline, and platform settings' }] : []),
  ]

  return (
    <nav className="flex flex-col gap-1">
      {items.map((it) => {
        const Ic = it.icon
        if (it.soon) {
          return (
            <span key={it.label} title="Coming soon" className={`${base} cursor-default text-ink`}>
              <Ic size={24} />
              <span>{it.label}</span>
              <span className="ml-auto rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                soon
              </span>
            </span>
          )
        }
        return (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            title={it.title}
            onClick={onNavigate}
            className={({ isActive }) =>
              `${base} ${isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-black/5'}`
            }
          >
            <Ic size={24} />
            <span>{it.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}