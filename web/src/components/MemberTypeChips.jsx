import { MEMBER_TYPES } from '../lib/options'

// Multi-select for member types: togglable pills over the fixed MEMBER_TYPES set. Visible options
// (recognition over recall) for a small list, instead of a hidden multi-select dropdown. `value`
// is the selected array; `onChange` receives the new array in canonical MEMBER_TYPES order.
export default function MemberTypeChips({ value, onChange }) {
  const selected = new Set(value || [])
  const toggle = (t) => {
    const next = new Set(selected)
    next.has(t) ? next.delete(t) : next.add(t)
    onChange(MEMBER_TYPES.filter((x) => next.has(x)))
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {MEMBER_TYPES.map((t) => {
        const on = selected.has(t)
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${on ? 'bg-accent-soft text-accent ring-accent/40' : 'text-muted ring-line hover:text-ink'}`}
          >
            {t}
          </button>
        )
      })}
    </div>
  )
}
