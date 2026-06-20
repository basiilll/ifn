// Visual walk of the Idea Pipeline with Playwright: logs in as the student, files an
// application through the real UI, screenshots every pipeline surface for both roles,
// then withdraws the test application. Screenshots land in /tmp/ifn-shots/.
// Run: SUPA_URL=... SUPA_KEY=... STUDENT_EMAIL=... MENTOR_EMAIL=... PASSWORD=... node scripts/e2e-visual.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://localhost:5173'
const OUT = '/tmp/ifn-shots'
const { STUDENT_EMAIL, MENTOR_EMAIL, PASSWORD, SUPA_URL, SUPA_KEY } = process.env
mkdirSync(OUT, { recursive: true })

async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.fill('#email', email)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
}

async function shot(page, name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log('shot', name)
}

// REST helpers for setup/teardown that the UI flow doesn't cover
async function restLogin(email) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return (await r.json()).access_token
}
async function rpc(token, fn, args = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  try { return { ok: r.ok, data: t ? JSON.parse(t) : null } } catch { return { ok: r.ok, data: t } }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
let ideaId = null
const sToken = await restLogin(STUDENT_EMAIL)

try {
  // ---- student ----
  await login(page, STUDENT_EMAIL)
  await page.goto(`${BASE}/pipeline`)
  await shot(page, '01-student-pipeline-home')

  await page.click('text=Apply')
  await page.waitForSelector('text=Apply to the Idea Pipeline')
  await shot(page, '02-application-form-empty')

  await page.fill('input[placeholder*="AgriSense"]', 'Visual Walk Idea')
  await page.selectOption('select', { label: 'AgriTech' })
  await page.fill('textarea[placeholder*="who has the problem"]', 'Hostel students lose track of shared late-night food orders; splits are disputed nightly and delivery minimums are missed.')
  await page.fill('input[placeholder*="Marginal wheat"]', 'Hostel students at IFHE, ~6000 on campus')
  await page.fill('textarea[placeholder*="Low power cameras"]', 'Order-pooling page per hostel wing with automatic split calculation and a runner rota.')
  await page.fill('input[placeholder*="Rahul"]', 'Basil (full stack), Claude (QA)')
  await page.fill('input[placeholder*="Presold"]', '12 simulated pre-orders across 3 hostels')
  await page.fill('input[placeholder*="TAM"]', 'TAM: 6k students')
  await shot(page, '03-application-form-filled')

  await page.click('text=Submit to Gate 1')
  await page.waitForURL(/\/pipeline\/.+/, { timeout: 15000 })
  ideaId = page.url().split('/pipeline/')[1]
  await shot(page, '04-student-dossier-g1')

  // ---- mentor picks via REST so we can shoot the mentor dossier states ----
  const mToken = await restLogin(MENTOR_EMAIL)
  const pages2 = await ctx.newPage()
  await pages2.close()

  // ---- mentor views ----
  const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const mpage = await mctx.newPage()
  await login(mpage, MENTOR_EMAIL)
  await mpage.goto(`${BASE}/mentor`)
  await mpage.click('text=Available ideas')
  await shot(mpage, '05-mentor-queue')

  await mpage.goto(`${BASE}/pipeline/${ideaId}`)
  await shot(mpage, '06-mentor-dossier-g1-preassign')

  await rpc(mToken, 'mentor_pick', { p_idea: ideaId })
  await mpage.reload()
  await shot(mpage, '07-mentor-dossier-g3-waiting-founder')

  // student submits G3 via REST, then shoot mentor review form (rubric)
  await rpc(sToken, 'submit_gate', { p_idea: ideaId, p_payload: {
    who_you_are: 'Second-year BCA, hostel canteen committee.', contact: 'test@local',
    market_value: 'Rs 40k/month in one hostel', market_size: '6000 students',
    feasibility_self: { technical: 'High', financial: 'Medium', market: 'High' },
  } })
  await mpage.reload()
  await shot(mpage, '08-mentor-review-g3-rubric')

  await mpage.goto(`${BASE}/admin`)
  await mpage.getByRole('button', { name: 'Pipeline', exact: true }).click()
  await shot(mpage, '09-admin-pipeline-inbox')
  await mpage.getByRole('button', { name: 'All ideas', exact: true }).click()
  await shot(mpage, '10-admin-pipeline-all')

  // student view of the same state + calendar with a deadline
  await rpc(mToken, 'action_create', { p_idea: ideaId, p_label: 'Interview 5 students', p_details: 'other hostels', p_due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) })
  await page.goto(`${BASE}/pipeline/${ideaId}`)
  await shot(page, '11-student-dossier-with-action')
  await page.goto(`${BASE}/calendar`)
  await shot(page, '12-student-calendar-deadline')

  await mctx.close()
} finally {
  if (ideaId) {
    const r = await rpc(sToken, 'withdraw_application', { p_idea: ideaId })
    console.log(r.ok ? 'cleaned up test idea' : 'CLEANUP FAILED ' + JSON.stringify(r.data))
  }
  await browser.close()
}
console.log('done ->', OUT)
