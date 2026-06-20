import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Trash2, ChevronDown, ExternalLink, CheckCircle2, Workflow, User, MessageSquare } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { NOTIF_TEXT, ifnTag } from '../lib/pipeline'
import { timeAgo } from '../lib/format'
import ConfirmModal from '../components/ConfirmModal'

const GENERIC_ERR = 'Something went wrong. Please try again.'

export default function Notifications() {
  const { isAdmin } = useAuth()
  // members have one list; admins get tabs: needs action | all activity
  const [tab, setTab] = useState(isAdmin ? 'needs' : 'mine')

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-extrabold">Notifications</h1>
      <p className="mt-0.5 text-sm text-muted">
        {isAdmin ? 'Everything happening across the network, and what needs you.' : 'Updates on your posts and applications.'}
      </p>

      {isAdmin ? (
        <>
          <Tabs tab={tab} setTab={setTab} />
          {tab === 'needs' ? (
            <div role="tabpanel" id="notif-panel-needs" aria-labelledby="notif-tab-needs"><NeedsAction /></div>
          ) : tab === 'all' ? (
            <div role="tabpanel" id="notif-panel-all" aria-labelledby="notif-tab-all"><ActivityList admin /></div>
          ) : (
            <div role="tabpanel" id="notif-panel-mine" aria-labelledby="notif-tab-mine"><ActivityList /></div>
          )}
        </>
      ) : (
        <ActivityList />
      )}
    </div>
  )
}

const TABS = [
  { key: 'needs', label: 'Needs action', icon: CheckCircle2 },
  { key: 'all', label: 'All activity', icon: Bell },
  { key: 'mine', label: 'Mine', icon: User },
]

function Tabs({ tab, setTab }) {
  const refs = useRef([])

  function onKeyDown(e) {
    const i = TABS.findIndex((t) => t.key === tab)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    setTab(TABS[next].key)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label="Notification views" onKeyDown={onKeyDown} className="mt-4 flex flex-wrap gap-2">
      {TABS.map((t, idx) => (
        <TabButton
          key={t.key}
          ref={(el) => { refs.current[idx] = el }}
          active={tab === t.key}
          onClick={() => setTab(t.key)}
          icon={t.icon}
          id={`notif-tab-${t.key}`}
          controls={`notif-panel-${t.key}`}
        >
          {t.label}
        </TabButton>
      ))}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, id, controls, children, ref }) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink hover:bg-black/5'
      }`}
    >
      <Icon size={15} /> {children}
    </button>
  )
}

// --- Needs action (admin): live to-do queue with inline approve/reject ---
function NeedsAction() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('admin_needs_action')
    if (e) { console.error(e); setError(GENERIC_ERR); return }
    setError(''); setItems(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function reviewSuccess(id, approve) {
    setBusy(id)
    const { error: e } = await supabase.rpc('admin_review_success', { p_id: id, p_approve: approve })
    setBusy(null)
    if (e) { console.error(e); return setError(GENERIC_ERR) }
    setItems((prev) => prev.filter((x) => x.ref_id !== id))
  }

  if (!items) return <Loading />
  return (
    <div className="mt-4">
      {error && <div role="alert" className="mb-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      {items.length === 0 ? (
        <Empty icon={CheckCircle2} title="Nothing needs you." sub="#Success requests and unassigned applications show up here." />
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((it) => (
            <li key={`${it.item_type}-${it.ref_id}`} className="flex flex-wrap items-center gap-3 p-4">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${it.item_type === 'success' ? 'bg-success/15 text-success' : 'bg-accent-soft text-accent'}`}>
                {it.item_type === 'success' ? <CheckCircle2 size={17} /> : it.item_type === 'solution' ? <MessageSquare size={17} /> : <Workflow size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {it.item_type === 'pipeline' && <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-muted">{ifnTag(it.ifn)}</span>}
                  <span className="truncate text-sm font-bold">{it.title}</span>
                </div>
                <div className="truncate text-xs text-muted">{it.subtitle} · {timeAgo(it.created_at)}</div>
              </div>
              {it.item_type === 'success' ? (
                <div className="flex shrink-0 gap-2">
                  <button className="btn-primary min-h-9 px-3 py-1.5 text-xs" disabled={busy === it.ref_id} onClick={() => reviewSuccess(it.ref_id, true)}>Approve</button>
                  <button className="btn-outline min-h-9 px-3 py-1.5 text-xs" disabled={busy === it.ref_id} onClick={() => reviewSuccess(it.ref_id, false)}>Reject</button>
                  <button className="btn-outline min-h-9 min-w-9 px-2.5 py-1.5 text-xs" aria-label="Open post" title="Open post" onClick={() => navigate(`/post/${it.ref_id}`)}><ExternalLink size={14} /></button>
                </div>
              ) : (
                <button className="btn-outline min-h-9 px-3 py-1.5 text-xs" onClick={() => navigate(it.item_type === 'solution' ? `/problem-hub/${it.ref_id}` : `/pipeline/${it.ref_id}`)}>Review</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- Activity list (member's own, or admin's all-activity) ---
function ActivityList({ admin = false }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    const { data, error: e } = admin
      ? await supabase.rpc('admin_all_notifications', { p_limit: 100 })
      : await supabase.rpc('my_notifications', { p_limit: 100 })
    if (e) { console.error(e); setError(GENERIC_ERR); return }
    setError(''); setRows(data || [])
    if (!admin) supabase.rpc('mark_notifications_read') // opening the page clears your unread
  }, [admin])
  useEffect(() => { load() }, [load])

  function openTarget(n) {
    if (n.idea_id) navigate(`/pipeline/${n.idea_id}`)
    else if (n.payload?.post_id) navigate(`/post/${n.payload.post_id}`)
  }

  async function markRead(n) {
    const readAt = new Date().toISOString()
    const { error: e } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', n.id)
    if (e) { console.error(e); return setError(GENERIC_ERR) }
    setError('')
    setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: readAt } : x)))
  }
  async function remove(n) {
    const { error: e } = await supabase.from('notifications').delete().eq('id', n.id)
    setConfirmDelete(null)
    if (e) { console.error(e); return setError(GENERIC_ERR) }
    setRows((prev) => prev.filter((x) => x.id !== n.id))
  }

  if (!rows) return <Loading />
  return (
    <div className="mt-4">
      {error && <div role="alert" className="mb-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      {rows.length === 0 ? (
        <Empty icon={Bell} title={admin ? 'No activity yet.' : "You're all caught up."} sub={admin ? 'Network events will appear here.' : 'Updates on your posts and applications land here.'} />
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((n) => {
            const open = openId === n.id
            const target = n.idea_id || n.payload?.post_id
            return (
              <li key={n.id}>
                <button
                  onClick={() => setOpenId(open ? null : n.id)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-black/5"
                  aria-expanded={open}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-line' : 'bg-accent'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? 'text-ink' : 'font-semibold text-ink'}`}>{NOTIF_TEXT[n.kind] || n.kind}</span>
                    <span className="block truncate text-xs text-muted">
                      {n.idea_title || n.payload?.title || ''}
                      {n.actor_name ? ` · ${n.actor_name}` : ''}
                      {admin && n.recipient_name ? ` → ${n.recipient_name}` : ''}
                      {` · ${timeAgo(n.created_at)}`}
                    </span>
                  </span>
                  <ChevronDown size={16} className={`mt-0.5 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-page/60 px-4 py-3">
                    {target && (
                      <button className="btn-outline inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => openTarget(n)}>
                        <ExternalLink size={13} /> Open {n.idea_id ? 'application' : 'post'}
                      </button>
                    )}
                    {!admin && !n.read_at && (
                      <button className="btn-outline inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => markRead(n)}>
                        <Check size={13} /> Mark read
                      </button>
                    )}
                    {!admin && (
                      <button className="btn inline-flex min-h-9 items-center gap-1.5 border border-down/40 px-3 py-1.5 text-xs text-down hover:bg-down/10" onClick={() => setConfirmDelete(n)}>
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                    {!target && admin && <span className="text-xs text-muted">No linked item.</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this notification?"
          message="This can't be undone."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function Loading() {
  return (
    <ul className="card mt-4 animate-pulse divide-y divide-line">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 p-4">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 rounded bg-line" style={{ width: `${55 - i * 6}%` }} />
            <span className="block h-2.5 w-3/4 rounded bg-line" />
          </span>
        </li>
      ))}
    </ul>
  )
}
function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="card mt-0 p-10 text-center">
      <Icon size={28} className="mx-auto text-faint" />
      <p className="mt-2 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{sub}</p>
    </div>
  )
}
