// Add-to-calendar helpers (Option 1: per-event export, no integration/OAuth).
// Google gets a one-click template URL; everyone else (Apple, Outlook) gets a .ics file.

const TYPES = ['Workshop', 'Mentorship', 'Deadline', 'Hackathon', 'Other']

export const EVENT_TYPES = TYPES

// tailwind classes per type for chips/dots
export function typeClass(type) {
  switch (type) {
    case 'Workshop': return 'bg-accent-soft text-accent'
    case 'Mentorship': return 'bg-success/15 text-success'
    case 'Deadline': return 'bg-down/15 text-down'
    case 'Hackathon': return 'bg-warn/20 text-warnink'
    default: return 'bg-line text-ink'
  }
}
export function typeDot(type) {
  switch (type) {
    case 'Workshop': return 'bg-accent'
    case 'Mentorship': return 'bg-success'
    case 'Deadline': return 'bg-down'
    case 'Hackathon': return 'bg-warn'
    default: return 'bg-faint'
  }
}

// UTC stamp in iCal basic format: 20260620T093000Z
function icsStamp(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// if no end time, default to start + 1h so calendars render a block
function endOf(ev) {
  if (ev.ends_at) return ev.ends_at
  return new Date(new Date(ev.starts_at).getTime() + 60 * 60 * 1000).toISOString()
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m)
}

export function googleCalUrl(ev) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title || 'Event',
    dates: `${icsStamp(ev.starts_at)}/${icsStamp(endOf(ev))}`,
    details: ev.description || '',
    location: ev.location || '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function buildICS(ev) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IFN//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.id}@ifn`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(ev.starts_at)}`,
    `DTEND:${icsStamp(endOf(ev))}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    `LOCATION:${icsEscape(ev.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

// Shape a pipeline action-item deadline like an event so googleCalUrl/downloadICS work on it.
// Renders as a 9-10am block on the due date in the user's local timezone.
export function actionEvent(a) {
  const starts = new Date(`${a.due_date}T09:00:00`)
  return {
    id: a.id,
    title: a.idea_title ? `${a.idea_title}: ${a.label}` : a.label,
    description: `${a.details || ''}${a.ifn ? `\n(IFN-${a.ifn} action item)` : ''}`.trim(),
    location: '',
    type: 'Deadline',
    starts_at: starts.toISOString(),
    ends_at: null,
  }
}

// Apple Calendar has no add-event URL; downloading the .ics opens it straight in.
export function downloadICS(ev) {
  const blob = new Blob([buildICS(ev)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(ev.title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
