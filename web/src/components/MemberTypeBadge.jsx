// The descriptive "registering as" label (profiles.member_type), shown as a badge in public
// views (Directory, profiles). Distinct from RoleBadge, which is the permission level and is
// shown only in the admin panel. Renders nothing when no type is set.
export default function MemberTypeBadge({ type }) {
  if (!type) return null
  return (
    <span className="inline-flex rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
      {type}
    </span>
  )
}
