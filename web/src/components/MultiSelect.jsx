import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

// Dropdown multi-select: a closed box shows the picks as removable chips and opens a
// checklist. Matches the app's `input` styling. value/onChange are a string[].
export default function MultiSelect({ value = [], onChange, options, placeholder = 'Select...', id }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])
  // show search only when the list is long enough to need it
  const searchable = options.length > 8
  const shown = query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options

  return (
    <div ref={wrapRef} className="relative">
      <div
        id={id}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } }}
        className="input flex min-h-[42px] w-full cursor-pointer flex-wrap items-center gap-1.5 pr-9"
      >
        {value.length === 0 ? (
          <span className="text-muted">{placeholder}</span>
        ) : (
          value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={(e) => { e.stopPropagation(); toggle(v) }}
                className="-m-1.5 grid h-6 w-6 place-items-center rounded hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))
        )}
        <ChevronDown size={16} aria-hidden className={`absolute right-3 top-1/2 -translate-y-1/2 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-line bg-card shadow-pop">
          {searchable && (
            <input
              autoFocus
              className="input m-1 w-[calc(100%-0.5rem)] py-1.5 text-sm"
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <ul role="listbox" aria-multiselectable="true" className="max-h-56 overflow-auto p-1">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match.</li>}
          {shown.map((o) => {
            const on = value.includes(o)
            return (
              <li key={o} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => toggle(o)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${on ? 'text-accent' : 'text-ink hover:bg-black/5'}`}
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
                    {on && <Check size={12} />}
                  </span>
                  <span className={on ? 'font-semibold' : ''}>{o}</span>
                </button>
              </li>
            )
          })}
          </ul>
        </div>
      )}
    </div>
  )
}
