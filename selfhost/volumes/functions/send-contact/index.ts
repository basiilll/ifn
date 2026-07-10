// send-contact: member-to-member first-contact relay. The browser never sees any address.
//
// Flow:
//   1. Authorize the caller from their JWT.
//   2. contact_member() RPC (as the caller) enforces not-banned + reachable + not-self + the
//      daily cap and writes the audit row. It raises a client-surfaceable message on any block.
//   3. Resolve the recipient's real email with the service role (never returned to the client).
//   4. Send over the SAME SMTP that GoTrue uses for auth mail (Resend's SMTP relay in prod,
//      Mailpit in staging), reusing the existing SMTP_* env. reply_to is the sender's address
//      so the recipient can reply directly; this reveals the initiator's email to the recipient
//      by design (they chose to reach out). The recipient's address is never shown to the sender.
//
// Env (all already used by the GoTrue mailer): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//   SMTP_ADMIN_EMAIL (From address), SMTP_SENDER_NAME (From name). Plus the platform-injected
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy: copy into selfhost/volumes/functions/ and recreate the functions container, or
//         `supabase functions deploy send-contact`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Same SMTP the GoTrue mailer uses. In prod this is Resend's SMTP relay (key in SMTP_PASS).
  const SMTP_HOST = Deno.env.get('SMTP_HOST')
  const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '587')
  const SMTP_USER = Deno.env.get('SMTP_USER') ?? ''
  const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? ''
  const FROM_EMAIL = Deno.env.get('SMTP_ADMIN_EMAIL') ?? 'no-reply@ifn.local'
  const FROM_NAME = Deno.env.get('SMTP_SENDER_NAME') ?? 'ICFAI Founders Network'
  if (!SMTP_HOST) return json({ error: 'Contact relay is not configured.' }, 500)

  let to: unknown, subject: unknown, message: unknown
  try {
    const body = await req.json()
    to = body.to
    subject = body.subject
    message = body.message
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof to !== 'string' || !UUID_RE.test(to)) return json({ error: 'A valid recipient is required.' }, 400)
  const subj = (typeof subject === 'string' ? subject : '').trim()
  const msg = (typeof message === 'string' ? message : '').trim()
  if (!msg) return json({ error: 'Message cannot be empty.' }, 400)
  if (subj.length > 200) return json({ error: 'Subject is too long.' }, 400)
  if (msg.length > 5000) return json({ error: 'Message is too long.' }, 400)

  // 1. Authorize the caller and read their display name (own-row read is allowed by RLS).
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)
  const senderEmail = userData.user.email
  const { data: meRow } = await caller.from('profiles').select('name').eq('id', userData.user.id).single()
  const senderName = meRow?.name?.trim() || 'A network member'

  // 2. Enforce policy + rate limit + audit, as the caller. Raises on any block.
  //    ponytail: the audit row and daily cap are consumed here, before the send. If SMTP later
  //    fails the attempt still counts. Acceptable; a compensating delete would need a second RPC.
  const { error: gateErr } = await caller.rpc('contact_member', { p_to: to, p_subject: subj || null })
  if (gateErr) {
    const m = gateErr.message || 'Could not send the message.'
    const status = /daily message limit/i.test(m)
      ? 429
      : /not reachable|yourself|not authenticated|read-only|restricted|banned/i.test(m)
      ? 403
      : 400
    return json({ error: m }, status)
  }

  // 3. Resolve the recipient's real email with the service role. Never returned to the client.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: rc, error: rcErr } = await admin.auth.admin.getUserById(to)
  const recipientEmail = rc?.user?.email
  if (rcErr || !recipientEmail) {
    console.error('recipient resolve failed:', rcErr)
    return json({ error: 'Could not deliver the message.' }, 502)
  }

  // 4. Send over SMTP (same relay as auth mail).
  const text =
    `${senderName} sent you a message through the ICFAI Founders Network directory.\n\n` +
    (subj ? `Subject: ${subj}\n\n` : '') +
    `${msg}\n\n` +
    `Reply to this email to respond to ${senderName} directly.`
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465,
      auth: SMTP_USER ? { username: SMTP_USER, password: SMTP_PASS } : undefined,
    },
  })
  try {
    await client.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: recipientEmail,
      replyTo: senderEmail || undefined,
      subject: subj ? `[IFN] ${subj}` : `[IFN] ${senderName} sent you a message`,
      content: text,
    })
  } catch (err) {
    console.error('smtp send failed:', err)
    return json({ error: 'Could not send the message. Please try again later.' }, 502)
  } finally {
    try { await client.close() } catch { /* ignore */ }
  }

  return json({ ok: true })
})
