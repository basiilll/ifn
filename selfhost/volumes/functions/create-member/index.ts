// create-member (LOGIN-ONLY FORK): an admin creates a confirmed member account with a
// per-user temp password. No email is sent from here — the password is returned once and the
// admin sends a welcome via their own mail client (mailto) from the Add-member UI.
//
// The SPA holds only the anon key, so creating a confirmed user with a known password needs
// the service-role key, which must never reach the browser — hence this function.
//
// Authorization: the caller's JWT is checked against profiles.role === 'admin' (403 otherwise)
// before a service-role call creates the auth user. The new account is flagged
// must_change_password = true, so the user is forced to set their own password on first login.
//
// IMPORTANT: this talks ONLY to the internal API gateway (SUPABASE_URL = http://kong:8000) via
// plain fetch. It does NOT import supabase-js from the network — the self-hosted edge-runtime
// has no guaranteed internet egress, and a boot-time `https://esm.sh/...` import made every call
// hang/fail ("worker boot error: ... Connection timed out"). Kong is always reachable on the
// docker network, so this is robust regardless of egress.

import { generatePassword } from '../_shared/password.ts'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*', // set ALLOWED_ORIGIN secret to lock to your app domain
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  let email: unknown, role: unknown, memberTypesRaw: unknown, nameRaw: unknown
  try {
    const body = await req.json()
    email = body.email
    role = body.role
    memberTypesRaw = body.member_types
    nameRaw = body.name
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const memberTypes = Array.isArray(memberTypesRaw)
    ? memberTypesRaw.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    : []
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : null
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: 'A valid email is required.' }, 400)
  }
  if (typeof role !== 'string' || !['mentor', 'admin', 'student'].includes(role)) {
    return json({ error: 'role must be mentor, admin, or student' }, 400)
  }
  const addr = email.trim().toLowerCase()

  // 1. Authorize the caller: resolve their user id from the JWT (GoTrue), then confirm their
  //    profiles.role === 'admin'. The role read uses the service key (server-side check).
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: authHeader },
  })
  if (!meRes.ok) return json({ error: 'Not authenticated' }, 401)
  const me = await meRes.json().catch(() => null)
  const callerId = me?.id
  if (!callerId) return json({ error: 'Not authenticated' }, 401)

  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=role`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  )
  const roleRows = roleRes.ok ? await roleRes.json().catch(() => []) : []
  if (!Array.isArray(roleRows) || roleRows[0]?.role !== 'admin') {
    return json({ error: 'Not authorized' }, 403)
  }

  // 2. Create the confirmed account (service role) so they can sign in at once.
  const password = generatePassword()
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: addr, password, email_confirm: true }),
  })
  const created = await createRes.json().catch(() => ({} as Record<string, unknown>))
  const createdId = (created as { id?: string })?.id
  if (!createRes.ok || !createdId) {
    const raw = JSON.stringify(created)
    const dup = /already.*registered|already exists|duplicate|been registered/i.test(raw)
    const msg = (created as { msg?: string; error_description?: string; error?: string })?.msg
      || (created as { error_description?: string })?.error_description
      || (created as { error?: string })?.error
      || 'Could not create the account.'
    return json({ error: dup ? 'That email already has an account.' : msg }, dup ? 409 : 400)
  }

  // 3. Set role + member_type + optional name on the trigger-created profile row, and force a
  //    password change on first login (the temp password below is single-use in practice).
  const patch: Record<string, unknown> = {
    role,
    member_types: memberTypes,
    member_type: memberTypes[0] ?? null,
    must_change_password: true,
  }
  if (name) patch.name = name
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${createdId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  })
  if (!patchRes.ok) {
    const t = await patchRes.text().catch(() => '')
    // The account exists but the patch didn't stick. Surface it (with the password) so the
    // admin can fix the role from the Members tab rather than leaving a misroled account.
    return json({ error: `Account created, but setup failed: ${t || patchRes.status}. Fix it from the Members tab.`, password }, 500)
  }

  // No email sent: the admin sends the welcome (with this password) via mailto from the UI.
  return json({ ok: true, email: addr, role, name, member_types: memberTypes, password })
})
