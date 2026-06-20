import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Accessible modal shell: focus moves into the panel on open, Tab is trapped inside,
// Esc and backdrop click both go through onRequestClose (so dirty-guards apply
// everywhere), and focus returns to the opener on close.
export default function ModalShell({ onRequestClose, labelledBy, children, className = '' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(onRequestClose)
  useEffect(() => {
    closeRef.current = onRequestClose
  }, [onRequestClose])

  useEffect(() => {
    const opener = document.activeElement
    const panel = panelRef.current
    panel.focus()

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card relative z-10 my-8 w-full max-w-lg p-6 outline-none animate-pop-in ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
