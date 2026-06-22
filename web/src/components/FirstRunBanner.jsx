import { useEffect, useState } from 'react'
import { FolderHeart, HeartHandshake, Puzzle, Workflow, X } from 'lucide-react'

const BANNER_KEY = 'ifn-welcome-banner-v1'

const SECTIONS = [
  { icon: Workflow, label: 'Idea Pipeline', desc: 'Track your startup through 6 mentor-reviewed gates, from first submission to incubation.' },
  { icon: Puzzle, label: 'Problem Hub', desc: 'Post a real-world problem; the network proposes and votes on solutions.' },
  { icon: HeartHandshake, label: 'Services', desc: 'Offer or request skills, intros, and resources from fellow founders.' },
  { icon: FolderHeart, label: 'Autopsy Library', desc: 'Post-mortems of failed ideas — what went wrong and what survived.' },
]

export default function FirstRunBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(BANNER_KEY)) setShow(true)
    } catch { /* storage unavailable */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(BANNER_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="mb-4 rounded-xl border border-accent/20 bg-accent-soft px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-accent">Welcome to IFN — here's what's here for you.</p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-full p-1 text-accent/60 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label="Dismiss welcome message"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {SECTIONS.map(({ icon: Ic, label, desc }) => (
          <li key={label} className="flex items-start gap-2.5">
            <Ic size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="text-sm">
              <span className="font-semibold text-ink">{label}:</span>{' '}
              <span className="text-muted">{desc}</span>
            </span>
          </li>
        ))}
      </ul>
      <button
        onClick={dismiss}
        className="mt-3 text-xs font-semibold text-accent/70 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
      >
        Got it, don't show again
      </button>
    </div>
  )
}
