import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Editable combobox: type to filter AND pick from the dropdown at the same time. The typed
// text IS the value (free entry allowed), so it works for free-text fields like region/state.
// Matches the app's `input` styling.
export default function Combobox({ value, onChange, options, placeholder = '', id, maxLength = 80, required = false }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1) // highlighted index
  const wrapRef = useRef(null)

  const q = (value || '').toLowerCase().trim()
  // show all when the box matches the current value exactly (so opening shows the full list)
  const matches = options.filter((o) => o.toLowerCase().includes(q))
  const list = q && !options.some((o) => o.toLowerCase() === q) ? matches : options

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(v) {
    onChange(v)
    setOpen(false)
    setHi(-1)
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      if (hi >= 0 && list[hi]) { e.preventDefault(); pick(list[hi]) } else setOpen(false)
    } else if (e.key === 'Escape') { setOpen(false); setHi(-1) }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        className="input pr-9"
        value={value || ''}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        required={required}
        aria-required={required ? 'true' : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-activedescendant={open && hi >= 0 && list[hi] && id ? `${id}-opt-${hi}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <ChevronDown
        size={16}
        aria-hidden
        onClick={() => setOpen((o) => !o)}
        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-faint"
      />
      {open && list.length > 0 && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-line bg-card p-1 shadow-pop"
        >
          {list.map((o, i) => (
            <li key={o} id={id ? `${id}-opt-${i}` : undefined} role="option" aria-selected={o === value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                onMouseEnter={() => setHi(i)}
                className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  i === hi ? 'bg-accent-soft text-accent' : o === value ? 'font-semibold text-ink' : 'text-ink hover:bg-black/5'
                }`}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
