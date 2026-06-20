const STYLES = {
  student: 'bg-accent-soft text-accent',
  mentor: 'bg-success/15 text-success',
  admin: 'bg-warn/25 text-warnink',
}
const LABELS = { student: 'User level', mentor: 'Mentor level', admin: 'Admin level' }

export default function RoleBadge({ role }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STYLES[role] || STYLES.student}`}>
      {LABELS[role] || role}
    </span>
  )
}
