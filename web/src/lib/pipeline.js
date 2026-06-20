// Idea Pipeline constants shared by the Pipeline, Mentor Review, and Admin surfaces.
// Gate semantics + submission templates mirror db/pipeline.sql (the server re-validates).

export const GATES = [
  { g: 1, label: 'Idea Submitted', desc: 'Your application is in the mentor queue.' },
  { g: 2, label: 'Mentor Assigned', desc: 'An admin assigned a mentor; waiting for them to accept.' },
  { g: 3, label: 'Mentor Picked Up', desc: 'Mentor engaged. Complete the full dossier (details + files).' },
  { g: 4, label: 'Review Completed', desc: 'Dossier approved on the rubric. Submit your beta plan.' },
  { g: 5, label: 'Beta Prototyping', desc: 'Build. Advancing needs evidence (prototype link or files), or a mentor bypass when the prototype needs funding.' },
  { g: 6, label: 'Incubation', desc: 'Confirmed for incubation. Work continues via actions and the thread.' },
]

export const gateLabel = (g) => GATES.find((x) => x.g === g)?.label || `Gate ${g}`

// Gate labels name the milestone just *reached*; this names what to DO right now, so the
// headline matches the task (G4 "Review Completed" is really "submit your beta plan").
const GATE_TASK = {
  3: { awaiting_submission: 'Complete the dossier', submitted: 'Dossier in review', revision_requested: 'Dossier needs revision' },
  4: { awaiting_submission: 'Submit your beta plan', submitted: 'Beta plan in review', revision_requested: 'Beta plan needs revision' },
  5: { awaiting_submission: 'Submit prototype evidence', submitted: 'Evidence in review', revision_requested: 'Evidence needs revision' },
}
export function currentTask(idea) {
  if (idea.pipeline_state === 'rejected') return 'Rejected (final)'
  if (idea.pipeline_state === 'refine') return 'Refine & retry'
  if (idea.gate === 1) return 'In the mentor queue'
  if (idea.gate === 2) return 'Awaiting mentor acceptance'
  if (idea.gate >= 6 || idea.gate_status === 'approved') return 'In incubation'
  return GATE_TASK[idea.gate]?.[idea.gate_status] || gateLabel(idea.gate)
}

// For the forward "you advanced" banner: the milestone that unlocked this awaiting step.
export const JUST_UNLOCKED = { 3: 'Mentor engaged', 4: 'Dossier approved', 5: 'Beta plan approved' }

// Current-step dot color, so the stepper carries state (not just position).
export function stepDotClass(gateStatus, state) {
  if (state === 'rejected') return 'bg-down text-white'
  if (gateStatus === 'submitted') return 'bg-warn text-warnink ring-4 ring-warn/20'  // in review
  if (gateStatus === 'approved') return 'bg-success text-white'
  return 'bg-accent text-onaccent ring-4 ring-accent/20'                              // your move
}

// Whose turn is it (server-derived); label + tone for chips.
export const WAITING = {
  student: { label: 'Your move', tone: 'bg-accent-soft text-accent' },
  mentor: { label: 'With mentor', tone: 'bg-success/15 text-success' },
  'mentor-pool': { label: 'In mentor queue', tone: 'bg-black/5 text-muted' },
  admin: { label: 'Needs admin', tone: 'bg-down/15 text-down' },
  none: { label: 'Done', tone: 'bg-black/5 text-muted' },
}
export const waitingChip = (w) => WAITING[w] || WAITING.none

export const STATES = {
  active: { label: 'Active', tone: 'bg-success/15 text-success' },
  refine: { label: 'Refine & retry', tone: 'bg-accent-soft text-accent' },
  rejected: { label: 'Rejected', tone: 'bg-down/15 text-down' },
}

export const LEVELS = ['High', 'Medium', 'Low']

// Mentor rubric (7 criteria, scored 1-5). Keys match review_gate's server check.
export const RUBRIC = [
  { k: 'clarity', label: 'Clarity' },
  { k: 'feasibility', label: 'Feasibility' },
  { k: 'market_potential', label: 'Market potential' },
  { k: 'innovation', label: 'Innovation' },
  { k: 'technical', label: 'Technical' },
  { k: 'scalability', label: 'Scalability' },
  { k: 'ps_fit', label: 'Problem-solution fit' },
]

// Notification copy for the bell.
export const NOTIF_TEXT = {
  mentor_assigned: 'Mentor assigned',
  mentor_unassigned: 'Mentor unassigned',
  mentor_picked: 'A mentor picked up the idea',
  mentor_accepted: 'Mentor accepted the assignment',
  gate_submitted: 'New gate submission to review',
  review_approved: 'Gate approved',
  revision_requested: 'Revision requested',
  idea_rejected: 'Idea rejected',
  idea_refine: 'Sent back to refine & retry',
  gate_moved: 'Gate moved by an admin',
  action_created: 'New action item for you',
  action_done: 'An action item was completed',
  message_received: 'New message on an idea',
  application_withdrawn: 'An application was withdrawn',
  application_deleted: 'An application was removed by an admin',
  pipeline_stale: 'No pipeline movement in a while',
  problem_solution_received: 'New solution proposed on your problem',
  solution_reviewed: 'Your solution was reviewed',
  success_approved: 'Your #Success badge was approved',
  success_rejected: 'Your #Success request was declined',
  registration_request: 'New registration request to review',
}

export const ifnTag = (n) => `IFN-${n}`
