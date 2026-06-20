// End-to-end Idea Pipeline walk using two real accounts against the live Supabase project.
// Exercises: apply -> queue -> pick -> G3 dossier -> rubric -> G4 plan -> G5 bypass -> G6,
// action-item gating, thread, withdraw, admin board, guards, and the audit trail.
// Run:  SUPA_URL=... SUPA_KEY=... STUDENT_EMAIL=... MENTOR_EMAIL=... PASSWORD=... node scripts/e2e-pipeline.mjs
// Read-only against code; creates test rows and withdraws them at the end.

const URL = process.env.SUPA_URL
const KEY = process.env.SUPA_KEY
const PASSWORD = process.env.PASSWORD
const STUDENT = process.env.STUDENT_EMAIL
const MENTOR = process.env.MENTOR_EMAIL
if (!URL || !KEY || !PASSWORD || !STUDENT || !MENTOR) { console.error('missing env'); process.exit(2) }

let pass = 0, fail = 0, warn = 0
const failures = []
function ok(name, extra = '') { pass++; console.log(`  OK   ${name}${extra ? ' - ' + extra : ''}`) }
function bad(name, extra = '') { fail++; failures.push(`${name}${extra ? ' - ' + extra : ''}`); console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`) }
function note(name, extra = '') { warn++; console.log(`  WARN ${name}${extra ? ' - ' + extra : ''}`) }
function expect(cond, name, extra = '') { cond ? ok(name, extra) : bad(name, extra) }

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`login ${email}: ${j.error_description || j.msg || r.status}`)
  return j.access_token
}

async function rpc(token, fn, args = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: r.status, ok: r.ok, data, message: !r.ok ? (data?.message || text) : null }
}

const application = {
  target_user: 'Hostel students at IFHE who order late-night food in groups',
  team: 'E2E Bot (testing), Claude (QA)',
  traction: 'Simulated 12 pre-orders across 3 hostels',
  market_size: 'TAM: 6k students on campus',
}
const TITLE = `E2E Walk ${Date.now()}`

async function main() {
  console.log('\n== login ==')
  const s = await login(STUDENT)
  const m = await login(MENTOR)
  ok('student + mentor login')

  const created = []
  try {
    console.log('\n== G1: student files the application ==')
    let r = await rpc(s, 'pipeline_submit', {
      p_title: TITLE, p_sector: 'AgriTech',
      p_problem: 'Late-night group food orders from hostels get split badly; nobody tracks who owes what and delivery minimums are missed. Happens nightly.',
      p_solution: 'A lightweight order-pooling page per hostel wing with auto split and a runner rota.',
      p_application: application,
    })
    if (!r.ok) { bad('pipeline_submit', r.message); throw new Error('cannot continue without an application: ' + r.message) }
    const idea = r.data
    created.push(idea)
    ok('pipeline_submit', `idea ${idea}`)

    r = await rpc(s, 'my_pipeline')
    const mine = (r.data || []).find((x) => x.id === idea)
    expect(!!mine, 'my_pipeline shows the application')
    expect(mine?.gate === 1 && mine?.waiting_on === 'mentor-pool', 'G1 + waiting on mentor-pool', `gate=${mine?.gate} waiting=${mine?.waiting_on}`)

    console.log('\n== two distinct views of the same application ==')
    const dS = (await rpc(s, 'idea_dossier', { p_idea: idea })).data
    const dM0 = await rpc(m, 'idea_dossier', { p_idea: idea })
    expect(dS?.idea?.is_mine === true && dS?.idea?.is_mentor === false, 'student view: is_mine')
    // mentor/admin can read BEFORE any state change, and reading must not change state
    expect(dM0.ok, 'admin can view the dossier pre-assignment', dM0.message)
    const after = (await rpc(s, 'my_pipeline')).data.find((x) => x.id === idea)
    expect(after.gate === 1 && after.waiting_on === 'mentor-pool', 'viewing changed nothing (still G1/mentor-pool)')

    console.log('\n== queue + sector filter ==')
    r = await rpc(m, 'mentor_queue', { p_sector: 'AgriTech' })
    expect((r.data || []).some((x) => x.id === idea), 'queue shows it under AgriTech filter')
    r = await rpc(m, 'mentor_queue', { p_sector: 'FinTech' })
    expect(!(r.data || []).some((x) => x.id === idea), 'FinTech filter excludes it')
    r = await rpc(s, 'mentor_queue', {})
    expect(r.ok && (r.data || []).length === 0, 'student sees an empty queue (mentor-only data)')

    console.log('\n== pick: G1 -> G3 ==')
    r = await rpc(m, 'mentor_pick', { p_idea: idea })
    expect(r.ok, 'mentor_pick', r.message)
    let dM = (await rpc(m, 'idea_dossier', { p_idea: idea })).data
    expect(dM?.idea?.gate === 3 && dM?.idea?.gate_status === 'awaiting_submission', 'now G3 awaiting dossier')
    expect(dM?.idea?.waiting_on === 'student', 'waiting on founder')
    expect(dM?.idea?.is_mentor === true && dM?.idea?.is_mine === false, 'mentor view flags')

    console.log('\n== G3: founder submits, mentor must clear actions before approving ==')
    r = await rpc(s, 'submit_gate', { p_idea: idea, p_payload: {
      who_you_are: 'Second-year BCA, ran the hostel canteen committee.',
      contact: 'e2e@test.local',
      market_value: 'Rs 40k/month order volume in one hostel',
      market_size: '6000 students, 14 hostels',
      feasibility_self: { technical: 'High', financial: 'Medium', market: 'High' },
    } })
    expect(r.ok, 'submit_gate G3', r.message)

    r = await rpc(m, 'action_create', { p_idea: idea, p_label: 'Interview 5 students from another hostel', p_details: 'Confirm the pain exists beyond your own wing', p_due: new Date(Date.now() + 86400000).toISOString().slice(0, 10) })
    expect(r.ok, 'mentor assigns an action item', r.message)

    const rubric = { clarity: 4, feasibility: 4, market_potential: 3, innovation: 3, technical: 4, scalability: 3, ps_fit: 4 }
    r = await rpc(m, 'review_gate', { p_idea: idea, p_criteria: rubric, p_feasibility: { verdict: 'Confirmed', note: '' }, p_feedback: 'Solid start.', p_decision: 'approved' })
    expect(!r.ok && /open action/i.test(r.message || ''), 'approve BLOCKED while action item is open', r.ok ? 'guard missing: re-run db/pipeline.sql' : r.message)

    dS2 = (await rpc(s, 'idea_dossier', { p_idea: idea })).data
    const act = dS2.actions.find((a) => a.status === 'open')
    r = await rpc(s, 'action_done', { p_action: act.id, p_note: 'Done: 5/5 interviews, 4 would use it weekly' })
    expect(r.ok, 'founder closes the action with evidence', r.message)

    r = await rpc(m, 'review_gate', { p_idea: idea, p_criteria: rubric, p_feasibility: { verdict: 'Confirmed', note: '' }, p_feedback: 'Good rubric scores; proceed to beta planning.', p_decision: 'approved' })
    expect(r.ok, 'G3 approved with full rubric', r.message)

    console.log('\n== G4: beta plan, no rubric needed ==')
    r = await rpc(s, 'submit_gate', { p_idea: idea, p_payload: { beta_plan: 'One hostel wing, two weeks, manual runner rota, measure split disputes.', milestones: 'week1 pilot\nweek2 measure' } })
    expect(r.ok, 'submit_gate G4', r.message)
    r = await rpc(m, 'review_gate', { p_idea: idea, p_criteria: {}, p_feasibility: null, p_feedback: 'Plan is tight. Build it.', p_decision: 'approved' })
    expect(r.ok, 'G4 approved WITHOUT rubric', r.ok ? '' : `${r.message} (if rubric incomplete: re-run db/pipeline.sql)`)

    console.log('\n== G5: mentor bypass path (prototype needs money) ==')
    r = await rpc(s, 'submit_gate', { p_idea: idea, p_payload: { learnings: 'Manual pilot proved demand; real version needs UPI integration fees.', bypass_requested: true, bypass_reason: 'UPI sandbox + merchant onboarding costs Rs 15k we do not have.' } })
    expect(r.ok, 'G5 submitted with bypass instead of evidence', r.message)
    r = await rpc(m, 'review_gate', { p_idea: idea, p_criteria: {}, p_feasibility: null, p_feedback: 'Bypass justified; incubation will fund the prototype.', p_decision: 'approved' })
    expect(r.ok, 'G5 approved via bypass -> Incubation', r.message)
    dM = (await rpc(m, 'idea_dossier', { p_idea: idea })).data
    expect(dM.idea.gate === 6 && dM.idea.gate_status === 'approved' && dM.idea.waiting_on === 'none', 'terminal: G6 approved, nobody waiting')

    console.log('\n== thread + the documented record ==')
    r = await rpc(s, 'idea_message_send', { p_idea: idea, p_body: 'Thank you! When do we meet?' })
    expect(r.ok, 'founder message', r.message)
    r = await rpc(m, 'idea_message_send', { p_idea: idea, p_body: 'Logged: kickoff meeting Friday, office 2pm.', p_kind: 'meeting' })
    expect(r.ok, 'mentor meeting log', r.message)
    dM = (await rpc(m, 'idea_dossier', { p_idea: idea })).data
    expect(dM.transitions.length >= 5, 'audit trail complete', `${dM.transitions.length} transitions`)
    expect(dM.submissions.length === 3, 'all 3 gate submissions kept', `${dM.submissions.length}`)
    expect(dM.reviews.length >= 2, 'reviews kept', `${dM.reviews.length}`)
    expect(dM.actions.length === 1 && dM.actions[0].status === 'done' && !!dM.actions[0].done_note, 'action item + evidence in the record')
    expect(dM.messages.length === 2, 'thread in the record')

    console.log('\n== notifications reached the founder ==')
    r = await rpc(s, 'my_notifications', { p_limit: 30 })
    const kinds = new Set((r.data || []).map((n) => n.kind))
    for (const k of ['mentor_picked', 'review_approved', 'action_created']) {
      expect(kinds.has(k), `notification: ${k}`)
    }

    console.log('\n== guards (what must NOT work) ==')
    r = await rpc(s, 'review_gate', { p_idea: idea, p_criteria: {}, p_feasibility: null, p_feedback: 'hax', p_decision: 'approved' })
    expect(!r.ok, 'student cannot review')
    r = await rpc(s, 'admin_move_gate', { p_idea: idea, p_gate: 1, p_reason: 'hax' })
    expect(!r.ok, 'student cannot move gates')
    r = await rpc(m, 'admin_move_gate', { p_idea: idea, p_gate: 5, p_reason: '' })
    expect(!r.ok, 'admin override without a reason is rejected')
    r = await rpc(s, 'update_pipeline_idea', { p_idea: idea, p_title: 'late edit', p_sector: 'AgriTech', p_problem: 'x'.repeat(50), p_solution: 'y'.repeat(50), p_application: application })
    expect(!r.ok, 'application locked after G1 (no mid-review edits)')

    console.log('\n== admin board (read-only management view) ==')
    r = await rpc(m, 'admin_pipeline_counts')
    expect(r.ok && r.data?.total >= 1, 'funnel counts', r.message)
    r = await rpc(m, 'admin_pipeline_board', { p_sector: 'AgriTech' })
    expect((r.data || []).some((x) => x.id === idea), 'board sector filter finds it')

    console.log('\n== withdraw (second application) ==')
    r = await rpc(s, 'pipeline_submit', { p_title: `${TITLE} #2`, p_sector: 'EdTech', p_problem: 'Second test application meant to be withdrawn right away to verify deletion.', p_solution: 'None; this row exists to test withdraw_application end to end.', p_application: { target_user: 'n/a', team: 'n/a' } })
    if (r.ok) {
      const idea2 = r.data
      created.push(idea2)
      const w = await rpc(s, 'withdraw_application', { p_idea: idea2 })
      expect(w.ok, 'withdraw_application', w.message)
      const left = (await rpc(s, 'my_pipeline')).data.some((x) => x.id === idea2)
      expect(!left, 'withdrawn application is gone')
      if (w.ok) created.pop()
    } else bad('second pipeline_submit', r.message)

    console.log('\n== my_action_deadlines (calendar personal layer) ==')
    r = await rpc(s, 'my_action_deadlines')
    if (r.status === 404) note('my_action_deadlines missing', 're-run db/pipeline.sql')
    else expect(r.ok, 'my_action_deadlines callable', r.message)
  } finally {
    console.log('\n== cleanup ==')
    for (const id of created) {
      const r = await rpc(s, 'withdraw_application', { p_idea: id })
      console.log(`  ${r.ok ? 'cleaned' : 'CLEANUP FAILED'} ${id}${r.ok ? '' : ' - ' + r.message}`)
    }
  }

  console.log(`\n===== ${pass} ok / ${fail} fail / ${warn} warn =====`)
  if (failures.length) { console.log('failures:'); failures.forEach((f) => console.log('  - ' + f)) }
  process.exit(fail ? 1 : 0)
}

let dS2
main().catch((e) => { console.error('ABORT:', e.message); process.exit(1) })
