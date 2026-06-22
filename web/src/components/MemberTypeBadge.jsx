// The descriptive "registering as" label(s) (profiles.member_types), shown as badges in public
// views (Directory, profiles). Distinct from RoleBadge, which is the permission level and is
// shown only in the admin panel. Renders nothing when no types are set.
//
// Accepts `types` (array) — or a single `type` string for back-compat. `max` caps how many badges
// render before a "+N" overflow (use it in dense lists like the directory; omit on full profiles).
export default function MemberTypeBadge({ types, type, max }) {
  const list = (Array.isArray(types) ? types : type ? [type] : []).filter(Boolean)
  if (list.length === 0) return null
  const shown = max ? list.slice(0, max) : list
  const extra = list.length - shown.length
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span key={t} className="inline-flex rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
          {t}
        </span>
      ))}
      {extra > 0 && <span className="text-[11px] font-bold text-muted">+{extra}</span>}
    </span>
  )
}
