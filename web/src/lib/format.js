// Compact relative time, e.g. "3h", "2d", or a date for older posts.
export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const s = Math.floor((Date.now() - then) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}
