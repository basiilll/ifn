import { NavLink } from 'react-router-dom'
// COMBINED ALL ICONS INTO ONE SINGLE CLEAN IMPORT BLOCK:
import { Home, Workflow, Users, LayoutGrid, Shield, ClipboardCheck, FolderHeart, Puzzle } from 'lucide-react'
import { useAuth } from '../lib/AuthProvider'

// Twitter-style left rail. Built sections are links; the rest are placeholders until built,
// styled like real items (full contrast) with a small SOON tag.
const ITEMS = [
  { to: '/', label: 'Feed', icon: Home, end: true },
  { to: '/pipeline', label: 'Idea Pipeline', icon: Workflow },
  { to: '/problem-hub', label: 'Problem Hub', icon: Puzzle },
  { to: '/team', label: 'Team Acquisition', icon: Users },
  { to: '/directory', label: 'Directory', icon: LayoutGrid },
  { to: '/autopsy-library', label: 'Autopsy Library', icon: FolderHeart },
]

const base = 'flex items-center gap-3.5 rounded-lg px-4 py-3 text-base font-semibold transition-colors'

export default function SideNav({ onNavigate }) {
  const { isAdmin, isMentor } = useAuth()
  const items = [
    ...ITEMS,
    ...(isMentor ? [{ to: '/mentor', label: 'Mentor Review', icon: ClipboardCheck }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin Panel', icon: Shield }] : []),
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