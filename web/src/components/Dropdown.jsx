import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Compact pill dropdown. `children` is a render function receiving close().
export default function Dropdown({ label, children, align = 'left', width = 'min-w-[180px]' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors ${
          open ? 'border-accent text-accent' : 'border-line text-ink hover:bg-black/5'
        }`}
      >
        {label}
        <ChevronDown size={15} className={open ? 'text-accent' : 'text-muted'} />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-pop ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ active, onClick, children, role = 'menuitem' }) {
  return (
    <button
      onClick={onClick}
      role={role}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
        active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  )
}
