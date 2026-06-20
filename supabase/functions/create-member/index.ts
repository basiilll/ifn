// create-member (LOGIN-ONLY FORK): an admin creates a confirmed member account with a
// per-user temp password. No email is sent from here — the password is returned once and the
// admin sends a welcome via their own mail client (mailto) from the Add-member UI.
//
// The SPA holds only the anon key, so creating a confirmed user with a known password needs
// the service-role key, which must never reach the browser — hence this function.
//
// Authorization: the caller's JWT is checked against profiles.role === 'admin' (403 otherwise)
// before a service-role client creates the auth user. The new account is flagged
// must_change_password = true, so the user is forced to set their own password on first login.
//
// Deploy:  supabase functions deploy create-member
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let email: unknown, role: unknown, memberTypeRaw: unknown, nameRaw: unknown
  try {
    const body = await req.json()
    email = body.email
    role = body.role
    memberTypeRaw = body.member_type
    nameRaw = body.name
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const memberType = typeof memberTypeRaw === 'string' && memberTypeRaw.trim() ? memberTypeRaw.trim() : null
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : null
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: 'A valid email is required.' }, 400)
  }
  if (typeof role !== 'string' || !['mentor', 'admin', 'student'].includes(role)) {
    return json({ error: 'role must be mentor, admin, or student' }, 400)
  }
  const addr = email.trim().toLowerCase()

  // 1. Authorize the caller: must be an existing admin. Uses the caller's JWT against RLS
  //    (a user can read their own profile row), so this is the same check the client UI uses.
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)
  const { data: me, error: meErr } = await caller
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  if (meErr || me?.role !== 'admin') return json({ error: 'Not authorized' }, 403)

  // 2. Create the account with the service role. email_confirm so they can sign in at once.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const password = generatePassword()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: addr,
    password,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    const msg = createErr?.message || 'Could not create the account.'
    const status = /already.*registered|already exists|duplicate/i.test(msg) ? 409 : 400
    return json({ error: /already/i.test(msg) ? 'That email already has an account.' : msg }, status)
  }

  // 3. Set role + member_type + optional name on the trigger-created profile row, and force a
  //    password change on first login (the temp password below is single-use in practice).
  const patch: Record<string, unknown> = { role, member_type: memberType, must_change_password: true }
  if (name) patch.name = name
  const { error: roleErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', created.user.id)
  if (roleErr) {
    // The account exists but the patch didn't stick. Surface it (with the password) so the
    // admin can fix the role from the Members tab rather than leaving a misroled account.
    console.error('profile update failed:', roleErr)
    return json({ error: `Account created, but setup failed: ${roleErr.message}. Fix it from the Members tab.`, password }, 500)
  }

  // No email sent: the admin sends the welcome (with this password) via mailto from the UI.
  return json({ ok: true, email: addr, role, name, member_type: memberType, password })
})
