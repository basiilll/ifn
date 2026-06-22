import { useCallback, useEffect, useState } from 'react'
import { Search, Pin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { linkedinUrl } from '../lib/linkedin'
import { REGIONS, SECTORS, DOMAINS, MEMBER_TYPES } from '../lib/options'
import MemberTypeBadge from '../components/MemberTypeBadge'
import AuthorLink from '../components/AuthorLink'
import Dropdown, { MenuItem } from '../components/Dropdown'
import { useAuth } from '../lib/AuthProvider'

const GENERIC_ERR = 'Something went wrong. Please try again.'

// dropdown that takes a list of plain string options plus an "all" entry
function FilterDropdown({ label, value, options, onChange }) {
  const current = value || label
  return (
    <Dropdown label={current} width="w-52">
      {(close) => (
        <>
          <MenuItem active={!value} onClick={() => { onChange(''); close() }}>{label}</MenuItem>
          {options.map((o) => (
            <MenuItem key={o} active={value === o} onClick={() => { onChange(o); close() }}>{o}</MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  )
}

export default function Directory() {
  const { isAdmin, session } = useAuth()
  const uid = session?.user?.id
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [memberType, setMemberType] = useState('')
  const [region, setRegion] = useState('')
  const [sector, setSector] = useState('')
  const [domain, setDomain] = useState('')
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.rpc('directory', {
      p_search: debounced || null,
      p_region: region || null,
      p_sector: sector || null,
      p_domain: domain || null,
      p_member_type: memberType || null,
    })
    if (e) { console.error(e); setError('Could not load the directory. Check your connection and retry.') } else { setError(''); setMembers(data || []) }
    setLoading(false)
  }, [debounced, region, sector, domain, memberType])
  useEffect(() => { load() }, [load])

  async function togglePin(m) {
    const { error: e } = await supabase.rpc('admin_set_directory_pinned', { p_user: m.id, p_pinned: !m.pinned })
    if (e) { console.error(e); return setError(GENERIC_ERR) }
    load() // reload so pinned re-sorts to the top
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-extrabold">Directory</h1>
      <p className="mt-0.5 text-sm text-muted">Find people across the network and reach out directly.</p>

      <div className="relative mt-4">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9 placeholder:text-muted" aria-label="Search members" maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or startup..." />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterDropdown label="All types" value={memberType} options={MEMBER_TYPES} onChange={setMemberType} />
        <FilterDropdown label="All regions" value={region} options={REGIONS} onChange={setRegion} />
        <FilterDropdown label="All sectors" value={sector} options={SECTORS} onChange={setSector} />
        <FilterDropdown label="All domains" value={domain} options={DOMAINS} onChange={setDomain} />
        {(memberType || region || sector || domain || debounced) && (
          <button
            className="text-sm font-semibold text-muted hover:text-ink"
            onClick={() => { setMemberType(''); setRegion(''); setSector(''); setDomain(''); setQ('') }}
          >
            Clear
          </button>
        )}
      </div>

      <div aria-live="polite" aria-busy={loading}>
      {error ? (
        <div className="card mt-4 p-6 text-center" role="alert">
          <p className="text-sm text-down">{error}</p>
          <button className="btn-outline mt-3" onClick={load}>Retry</button>
        </div>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <MemberSkeleton key={i} />)}
        </div>
      ) : members.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="font-semibold">No members match these filters.</p>
        </div>
      ) : (
        <ul role="list" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.id} className={`card flex flex-col p-4 ${m.pinned ? 'border-accent/40' : ''}`}>
              <div className="flex items-center gap-3">
                <AuthorLink id={m.id} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-bold text-accent">
                  {(m.name || '?').charAt(0).toUpperCase()}
                </AuthorLink>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AuthorLink id={m.id} className="truncate text-sm font-bold">{m.name || 'Unnamed'}</AuthorLink>
                    <MemberTypeBadge types={m.member_types} max={2} />
                    {m.pinned && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                        <Pin size={10} /> Pinned
                      </span>
                    )}
                  </div>
                  {m.startup && <div className="truncate text-xs font-semibold text-muted">{m.startup}</div>}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => togglePin(m)}
                    title={m.pinned ? 'Unpin from the directory' : 'Pin to the top of the directory'}
                    aria-label={m.pinned ? `Unpin ${m.name}` : `Pin ${m.name}`}
                    className={`shrink-0 rounded-full p-2 transition-colors ${m.pinned ? 'text-accent hover:bg-accent-soft' : 'text-faint hover:bg-black/5 hover:text-ink'}`}
                  >
                    <Pin size={15} fill={m.pinned ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>

              {m.bio && <p className="mt-2 line-clamp-3 break-words text-sm text-muted">{m.bio}</p>}

              {(m.region || m.sector || m.domain) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.region && <span className="chip">{m.region}</span>}
                  {m.sector && <span className="chip">{m.sector}</span>}
                  {m.domain && <span className="chip">{m.domain}</span>}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {m.id !== uid && m.email && (
                  <a href={`mailto:${m.email}`} className="btn-outline px-3 py-1.5 text-xs">Email</a>
                )}
                {linkedinUrl(m.linkedin) && (
                  <a href={linkedinUrl(m.linkedin)} target="_blank" rel="noopener noreferrer" className="btn-outline px-3 py-1.5 text-xs">LinkedIn</a>
                )}
                {m.id === uid && <span className="px-1 py-1.5 text-xs text-muted">This is you</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>

    </div>
  )
}

function MemberSkeleton() {
  return (
    <div className="card animate-pulse p-4">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-line" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded bg-line" />
          <div className="h-2.5 w-20 rounded bg-line" />
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-6 w-16 rounded-full bg-line" />
        <div className="h-6 w-16 rounded-full bg-line" />
      </div>
      <div className="mt-3 h-8 w-24 rounded-full bg-line" />
    </div>
  )
}
