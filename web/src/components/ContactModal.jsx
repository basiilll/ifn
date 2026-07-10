import { useState } from 'react'
import ModalShell from './ModalShell'
import { supabase } from '../lib/supabase'

// First-contact relay: message another member through the send-contact edge function.
// No email address is ever exposed to the browser; the address is resolved server-side.
export default function ContactModal({ member, onClose }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function send(e) {
    e.preventDefault()
    if (!message.trim() || sending) return
    setSending(true)
    setError('')
    const { data, error: e2 } = await supabase.functions.invoke('send-contact', {
      body: { to: member.id, subject: subject.trim(), message: message.trim() },
    })
    setSending(false)
    if (e2 || data?.error) {
      // functions.invoke surfaces a non-2xx as a FunctionsHttpError; the JSON body is on .context.
      let m = data?.error
      if (!m && e2?.context?.json) {
        try { m = (await e2.context.json())?.error } catch { /* fall through to generic */ }
      }
      return setError(m || 'Could not send the message. Please try again.')
    }
    setSent(true)
  }

  return (
    <ModalShell onRequestClose={onClose} labelledBy="contact-title">
      {sent ? (
        <div className="text-center">
          <h2 id="contact-title" className="text-lg font-bold">Message sent</h2>
          <p className="mt-2 text-sm text-muted">
            Your message to {member.name || 'this member'} was delivered. They can reply to you by email.
          </p>
          <button className="btn-primary mt-4" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form onSubmit={send}>
          <h2 id="contact-title" className="text-lg font-bold">Message {member.name || 'this member'}</h2>
          <p className="mt-1 text-sm text-muted">
            We relay this by email. Your address is shared with them only if they reply.
          </p>

          <label className="mt-4 block text-sm font-semibold" htmlFor="contact-subject">
            Subject <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="contact-subject"
            className="input mt-1"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Reason for reaching out"
          />

          <label className="mt-3 block text-sm font-semibold" htmlFor="contact-message">Message</label>
          <textarea
            id="contact-message"
            className="input mt-1 min-h-[8rem]"
            maxLength={5000}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Introduce yourself..."
          />

          {error && <p className="mt-2 text-sm text-down" role="alert">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={sending || !message.trim()}>
              {sending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  )
}
