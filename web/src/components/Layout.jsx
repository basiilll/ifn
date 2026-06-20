import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import Topbar from './Topbar'
import SideNav from './SideNav'
import RightSidebar from './RightSidebar'
import { useAuth } from '../lib/AuthProvider'

// Authed app shell: sticky topbar + left rail (desktop) / drawer (mobile) + page Outlet.
export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const { restricted } = useAuth()
  const { pathname } = useLocation()
  const showRight = pathname === '/' // right rail only on the Feed

  useEffect(() => setNavOpen(false), [pathname]) // close drawer on navigation

  return (
    <div className="min-h-screen bg-page text-ink">
      <Topbar onMenu={() => setNavOpen(true)} />

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[80%] overflow-y-auto border-r border-line bg-card p-4 shadow-xl">
            <div className="mb-3 flex justify-end">
              <button onClick={() => setNavOpen(false)} className="rounded-full p-2 text-muted hover:bg-black/5" aria-label="Close navigation">
                <X size={20} />
              </button>
            </div>
            <SideNav onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div
        className={`mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-5 ${
          showRight ? 'lg:grid-cols-[250px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[250px_minmax(0,1fr)]'
        }`}
      >
        <aside className="hidden lg:block">
          <div className="sticky top-[72px]">
            <SideNav />
          </div>
        </aside>
        <main className="min-w-0">
          {restricted && (
            <div role="status" className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-sm text-warnink">
              <span className="font-semibold">Your account is in read-only mode.</span> You can browse, but posting, editing, voting, and messaging are turned off. Contact an admin if you think this is a mistake.
            </div>
          )}
          <Outlet />
        </main>
        {showRight && (
          <aside className="hidden lg:block">
            <div className="sticky top-[72px]">
              <RightSidebar />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
