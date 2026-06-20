import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, CalendarPlus, Download, MapPin, Clock, Flag } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { supabase } from '../lib/supabase'
import ModalShell from '../components/ModalShell'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../lib/AuthProvider'
import Spinner from '../components/Spinner'
import { EVENT_TYPES, typeClass, googleCalUrl, downloadICS, actionEvent } from '../lib/calendar'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const dayKey = (d) => startOfDay(d).toDateString()
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function Calendar() {
  const { isAdmin } = useAuth()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [events, setEvents] = useState([])
  const [deadlines, setDeadlines] = useState([]) // my open pipeline action items (private to me)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [deadlineDetail, setDeadlineDetail] = useState(null)
  const [formEvent, setFormEvent] = useState(undefined) // undefined = closed, null = new, obj = edit
  const [confirmDelete, setConfirmDelete] = useState(null) // event pending delete confirmation

  // 6-week grid starting on the Sunday on/before the 1st
  const gridStart = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const s = startOfDay(first)
    s.setDate(s.getDate() - s.getDay())
    return s
  }, [month])
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(d.getDate() + i); return d
  }), [gridStart])

  const load = useCallback(async () => {
    setLoading(true)
    const end = new Date(gridStart); end.setDate(end.getDate() + 42)
    const [ev, dl] = await Promise.all([
      supabase
        .from('events')
        .select('*')
        .gte('starts_at', gridStart.toISOString())
        .lt('starts_at', end.toISOString())
        .order('starts_at'),
      // personal layer: my action-item deadlines, derived via an auth-scoped RPC -
      // never rows in the shared events table, so they cannot reach anyone else's calendar
      supabase.rpc('my_action_deadlines'),
    ])
    if (ev.error) { console.error(ev.error); setError('Could not load the calendar. Check your connection and retry.') } else { setError(''); setEvents(ev.data || []) }
    if (dl.error) console.error(dl.error) // RPC missing pre-migration: events still render
    else setDeadlines(dl.data || [])
    setLoading(false)
  }, [gridStart])
  useEffect(() => { load() }, [load])

  const byDay = useMemo(() => {
    const m = {}
    for (const ev of events) (m[dayKey(ev.starts_at)] ||= []).push({ kind: 'event', ev })
    for (const a of deadlines) {
      const k = dayKey(new Date(`${a.due_date}T09:00:00`))
      ;(m[k] ||= []).push({ kind: 'deadline', a })
    }
    return m
  }, [events, deadlines])

  const todayKey = dayKey(new Date())
  const isEmptyMonth = !loading && !error && events.length === 0 && deadlines.length === 0

  async function deleteEvent(id) {
    const { error: e } = await supabase.rpc('admin_delete_event', { p_id: id })
    if (e) { console.error(e); setError('Could not delete the event. Try again.'); return }
    setConfirmDelete(null)
    setDetail(null)
    load()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Calendar</h1>
          <p className="mt-0.5 text-sm text-muted">Workshops, mentorship, deadlines and hackathons.</p>
        </div>
        {isAdmin && (
          <button className="btn-primary shrink-0" onClick={() => setFormEvent(null)}>
            <Plus size={16} /> Add event
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" className="rounded-full p-2 text-muted hover:bg-black/5"><ChevronLeft size={18} /></button>
        <h2 className="min-w-[10ch] text-center text-base font-bold">
          {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
        </h2>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month" className="rounded-full p-2 text-muted hover:bg-black/5"><ChevronRight size={18} /></button>
        <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }} className="btn-outline ml-2 px-3 py-2 text-xs">Today</button>
        {loading && <Spinner size={16} />}
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

      <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {DOW.map((d) => (
          <div key={d} className="bg-card px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-muted">{d}</div>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === month.getMonth()
          const isToday = dayKey(d) === todayKey
          const list = byDay[dayKey(d)] || []
          return (
            <div key={d.toISOString()} className="min-h-[92px] bg-card p-1.5" aria-current={isToday ? 'date' : undefined}>
              <div className={`mb-1 text-right text-xs font-semibold ${isToday ? 'text-accent' : inMonth ? 'text-muted' : 'text-faint'}`}>
                {isToday ? <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-accent text-onaccent">{d.getDate()}</span> : d.getDate()}
              </div>
              <div className="space-y-1">
                {list.slice(0, 3).map((it) =>
                  it.kind === 'event' ? (
                    <button
                      key={it.ev.id}
                      onClick={() => setDetail(it.ev)}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-1 text-left text-[11px] font-semibold ${typeClass(it.ev.type)}`}
                      title={`${it.ev.type}: ${it.ev.title}`}
                    >
                      <span className="sr-only">{it.ev.type}:</span>
                      <span className="truncate">{it.ev.title}</span>
                    </button>
                  ) : (
                    <button
                      key={it.a.id}
                      onClick={() => setDeadlineDetail(it.a)}
                      className="flex w-full items-center gap-1 truncate rounded border border-dashed border-down/50 bg-down/10 px-1 py-1 text-left text-[11px] font-semibold text-down"
                      title={`${it.a.label} (only you can see this)`}
                    >
                      <Flag size={10} className="shrink-0" />
                      <span className="truncate">{it.a.label}</span>
                    </button>
                  ),
                )}
                {list.length > 3 && <div className="px-1 text-[10px] font-semibold text-muted">+{list.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>

      {isEmptyMonth && (
        <p className="mt-3 text-center text-sm text-muted">
          No events this month.
          {isAdmin && <> <button className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => setFormEvent(null)}>Add one</button>.</>}
        </p>
      )}

      {detail && (
        <EventDetailModal
          ev={detail}
          isAdmin={isAdmin}
          onClose={() => setDetail(null)}
          onEdit={() => { setFormEvent(detail); setDetail(null) }}
          onDelete={() => setConfirmDelete(detail)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this event?"
          message={`"${confirmDelete.title}" will be removed from everyone's calendar. This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => deleteEvent(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {deadlineDetail && (
        <DeadlineDetailModal a={deadlineDetail} onClose={() => setDeadlineDetail(null)} />
      )}
      {formEvent !== undefined && (
        <EventFormModal
          ev={formEvent}
          onClose={() => setFormEvent(undefined)}
          onSaved={() => { setFormEvent(undefined); load() }}
        />
      )}
    </div>
  )
}

function EventDetailModal({ ev, isAdmin, onClose, onEdit, onDelete }) {
  const start = new Date(ev.starts_at)
  return (
    <Shell title={ev.title} onClose={onClose}>
      <span className={`mt-3 inline-flex rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${typeClass(ev.type)}`}>{ev.type}</span>

      <div className="mt-3 space-y-1.5 text-sm text-ink">
        <div className="flex items-center gap-2"><Clock size={15} className="text-muted" />
          {start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}{fmtTime(ev.starts_at)}{ev.ends_at ? ` - ${fmtTime(ev.ends_at)}` : ''}
        </div>
        {ev.location && <div className="flex items-center gap-2"><MapPin size={15} className="text-muted" /> {ev.location}</div>}
      </div>

      {ev.description && <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted">{ev.description}</p>}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <a href={googleCalUrl(ev)} target="_blank" rel="noreferrer" className="btn-primary">
          <CalendarPlus size={16} /> Add to Google
        </a>
        <button className="btn-outline" onClick={() => downloadICS(ev)}>
          <Download size={16} /> Apple / .ics
        </button>
        {isAdmin && (
          <div className="ml-auto flex gap-2">
            <button className="btn-outline" onClick={onEdit}>Edit</button>
            <button className="btn inline-flex items-center border border-down/40 px-4 py-2 text-sm text-down hover:bg-down/10" onClick={onDelete}>Delete</button>
          </div>
        )}
      </div>
    </Shell>
  )
}

// A pipeline action-item deadline: visible only to its owner (auth-scoped RPC, not an event row).
function DeadlineDetailModal({ a, onClose }) {
  const ev = actionEvent(a)
  return (
    <Shell title={a.label} onClose={onClose}>
      <span className="mt-3 inline-flex items-center gap-1 rounded-md bg-down/15 px-2.5 py-0.5 text-[11px] font-semibold text-down">
        <Flag size={11} /> My action item · IFN-{a.ifn}
      </span>
      <div className="mt-3 space-y-1.5 text-sm text-ink">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-muted" />
          due {new Date(`${a.due_date}T09:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="text-xs text-muted">From "{a.idea_title}". Only you can see this on the calendar.</div>
      </div>
      {a.details && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted">{a.details}</p>}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <a href={googleCalUrl(ev)} target="_blank" rel="noreferrer" className="btn-primary">
          <CalendarPlus size={16} /> Add to Google
        </a>
        <button className="btn-outline" onClick={() => downloadICS(ev)}>
          <Download size={16} /> Apple / .ics
        </button>
        <Link to={`/pipeline/${a.idea_id}`} className="btn-outline ml-auto" onClick={onClose}>Open idea</Link>
      </div>
    </Shell>
  )
}

function EventFormModal({ ev, onClose, onSaved }) {
  const editing = !!ev
  const [f, setF] = useState({
    title: ev?.title || '',
    type: ev?.type || 'Workshop',
    location: ev?.location || '',
    description: ev?.description || '',
    starts: ev?.starts_at ? new Date(ev.starts_at) : null,
    ends: ev?.ends_at ? new Date(ev.ends_at) : null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const initialRef = useRef(JSON.stringify({
    title: ev?.title || '', type: ev?.type || 'Workshop', location: ev?.location || '',
    description: ev?.description || '',
    starts: ev?.starts_at ? new Date(ev.starts_at).toISOString() : null,
    ends: ev?.ends_at ? new Date(ev.ends_at).toISOString() : null,
  }))
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  function requestClose() {
    if (busy) return
    const now = JSON.stringify({
      title: f.title, type: f.type, location: f.location, description: f.description,
      starts: f.starts ? f.starts.toISOString() : null,
      ends: f.ends ? f.ends.toISOString() : null,
    })
    if (now !== initialRef.current) { setConfirmDiscard(true); return }
    onClose()
  }

  async function save() {
    if (!f.title.trim()) return setError('Title is required.')
    if (!f.starts) return setError('Start time is required.')
    const startsIso = f.starts.toISOString()
    const endsIso = f.ends ? f.ends.toISOString() : null
    if (endsIso && endsIso < startsIso) return setError('End must be after start.')
    setBusy(true)
    const args = {
      p_title: f.title.trim(), p_description: f.description.trim(), p_location: f.location.trim(),
      p_type: f.type, p_starts_at: startsIso, p_ends_at: endsIso,
    }
    const { error: e } = editing
      ? await supabase.rpc('admin_update_event', { p_id: ev.id, ...args })
      : await supabase.rpc('admin_create_event', args)
    setBusy(false)
    if (e) { console.error(e); return setError('Could not save the event. Check your connection and try again.') }
    onSaved()
  }

  return (
    <Shell title={editing ? 'Edit event' : 'Add event'} onClose={requestClose}>
      {error && <div role="alert" className="mt-4 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      <div className="mt-4 space-y-3">
        <L label="Title *"><input className="input" maxLength={200} value={f.title} onChange={set('title')} placeholder="Demo Day" /></L>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <L label="Type">
            <select className="input" value={f.type} onChange={set('type')}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </L>
          <L label="Location"><input className="input" maxLength={200} value={f.location} onChange={set('location')} placeholder="Auditorium / Zoom link" /></L>
          <L label="Starts *">
            <DatePicker
              selected={f.starts}
              onChange={(d) => setF({ ...f, starts: d })}
              showTimeSelect
              timeIntervals={15}
              dateFormat="dd/MM/yyyy h:mm aa"
              placeholderText="dd/mm/yyyy, time"
              className="input"
              wrapperClassName="w-full"
            />
          </L>
          <L label="Ends">
            <DatePicker
              selected={f.ends}
              onChange={(d) => setF({ ...f, ends: d })}
              showTimeSelect
              timeIntervals={15}
              dateFormat="dd/MM/yyyy h:mm aa"
              placeholderText="optional"
              minDate={f.starts}
              isClearable
              className="input"
              wrapperClassName="w-full"
            />
          </L>
        </div>
        <L label={`Description (${f.description.length}/500)`}><textarea className="input min-h-[80px] resize-y" maxLength={500} value={f.description} onChange={set('description')} /></L>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Add event'}</button>
      </div>
      {confirmDiscard && (
        <ConfirmModal
          title={editing ? 'Discard your changes?' : 'Discard this event?'}
          message={editing ? 'Your edits will be lost.' : 'Your input will be lost.'}
          confirmLabel="Discard"
          tone="danger"
          onConfirm={() => { setConfirmDiscard(false); onClose() }}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </Shell>
  )
}

function Shell({ title, onClose, children }) {
  return (
    <ModalShell onRequestClose={onClose} labelledBy="shell-modal-title">
      <h2 id="shell-modal-title" className="break-words text-lg font-bold">{title}</h2>
      {children}
    </ModalShell>
  )
}

function L({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
