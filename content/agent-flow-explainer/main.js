const steps = [
  { title: 'The developer starts the conversation', copy: 'A rough idea is enough. The system gives it a path without taking control away from the human.', nodes: ['developer'], path: '', label: 'idea', pos: [13, 34], kicker: '01 — HUMAN DIRECTION', note: 'Intent stays with the developer.', detail: 'The lead does not invent the goal; it turns the developer’s direction into a reviewable specification.', state: 'intake open', line: 'tasks.add(“describe the desired outcome”)' },
  { title: 'Lead shapes a shared spec', copy: 'The lead turns the first iteration into a concrete, reviewable scope — asking, refining and making trade-offs visible.', nodes: ['developer', 'lead'], path: 'path-dev-lead', label: 'context', pos: [23, 24], kicker: '02 — SPECIFICATION', note: 'A conversation becomes a decision record.', detail: 'The developer and lead iterate until the desired outcome, constraints and acceptance criteria are explicit.', state: 'specification draft', line: 'actions.write(lead, “scope · decisions · risks”)' },
  { title: 'Approval creates the task', copy: 'When the developer approves, the harness creates a durable task. It is now a shared unit of work, not a chat message.', nodes: ['developer', 'lead', 'mcp'], path: 'path-lead-mcp', label: 'approved', pos: [48, 32], kicker: '03 — MCP RECEIVES IT', note: 'The MCP becomes the source of truth.', detail: 'tasks.add stores the objective and acceptance criteria. actions preserve why each choice was made.', state: 'task #142 created', line: 'tasks.add(title, description, acceptance)' },
  { title: 'Health gate protects the work', copy: 'Claiming the task runs native health. Green means normal mode; a failure blocks implementation but keeps diagnosis available.', nodes: ['mcp'], path: '', label: 'health', pos: [54, 45], kicker: '04 — SERVER-OWNED GATE', note: 'Fresh health authorizes the next move.', detail: 'A broken baseline cannot be silently inherited. Repair mode records a bounded reason and scope before implementation.', state: 'health ✓ normal mode', line: 'tasks.claim(142) → { health: “green”, mode: “normal” }' },
  { title: 'Explorer maps the territory', copy: 'The explorer reads the codebase and finds the relevant boundaries. It produces evidence, never speculative implementation.', nodes: ['mcp', 'explorer'], path: 'path-mcp-explorer', label: 'claim', pos: [69, 26], kicker: '05 — EXPLORE', note: 'Evidence arrives before code.', detail: 'The handoff gives the builder a map: files, contracts, risks and focused acceptance evidence.', state: 'exploration active', line: 'actions.handoff.write(explorer → builder)' },
  { title: 'Builder implements a bounded change', copy: 'The builder owns the scoped implementation and records what changed. The task context makes every action attributable.', nodes: ['explorer', 'builder'], path: 'path-explorer-builder', label: 'handoff', pos: [86, 27], kicker: '06 — BUILD', note: 'Implementation has a known boundary.', detail: 'The builder works from an approved spec and explorer handoff, then returns compact evidence for review.', state: 'implementation active', line: 'actions.start(142, “builder”)' },
  { title: 'Reviewer verifies the claim', copy: 'The reviewer checks behavior against the acceptance criteria, not merely whether the code looks plausible.', nodes: ['builder', 'reviewer'], path: 'path-builder-reviewer', label: 'evidence', pos: [86, 57], kicker: '07 — REVIEW', note: 'The reviewer owns the proof boundary.', detail: 'It can approve the claim or return a precise blocker. Review is a role with authority, not a final decoration.', state: 'review in progress', line: 'tasks.acceptance.update(criterionId)' },
  { title: 'A feedback loop, then a verifiable close', copy: 'If evidence is missing, the reviewer can call the builder back. Once approved, final health runs and the MCP closes the task.', nodes: ['mcp', 'builder', 'reviewer'], path: 'path-reviewer-mcp', label: 'done', pos: [69, 65], kicker: '08 — TRACEABLE COMPLETION', note: 'Review can reopen implementation — deliberately.', detail: 'The loop is explicit: reviewer → builder → reviewer. Only a fresh final health pass can close the task.', state: 'final health ✓ task done', line: 'tasks.update(142, “done”) → final health ✓' }
]

const title = document.querySelector('#stepTitle'), copy = document.querySelector('#stepCopy'), counter = document.querySelector('#stepCounter')
const packet = document.querySelector('#packet'), packetLabel = document.querySelector('#packetLabel'), annotation = document.querySelector('#annotation')
const consoleState = document.querySelector('#consoleState'), consoleLine = document.querySelector('#consoleLine'), progress = document.querySelector('#progress')
const canvas = document.querySelector('#canvas'); const pauseButton = document.querySelector('#pause'); let current = 0; let timer; let paused = false

progress.innerHTML = steps.map((_, i) => `<button role="tab" aria-label="Paso ${i + 1}" data-step="${i}"></button>`).join('')
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => render(+button.dataset.step)))

function render(index) {
  current = (index + steps.length) % steps.length; const step = steps[current]
  title.textContent = step.title; copy.textContent = step.copy; counter.textContent = `${String(current + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`
  document.querySelectorAll('.node').forEach(node => node.classList.toggle('active', step.nodes.includes(node.dataset.node)))
  document.querySelectorAll('.connections path').forEach(path => path.classList.toggle('active', path.id === step.path))
  packet.classList.toggle('visible', Boolean(step.path)); packetLabel.textContent = step.label; packet.style.left = `${step.pos[0]}%`; packet.style.top = `${step.pos[1]}%`
  annotation.innerHTML = `<span class="annotation-kicker">${step.kicker}</span><strong>${step.note}</strong><p>${step.detail}</p>`
  consoleState.textContent = step.state; consoleLine.textContent = step.line
  document.querySelectorAll('[data-step]').forEach((button, i) => button.classList.toggle('active', i === current))
  canvas.classList.remove('refresh'); void canvas.offsetWidth; canvas.classList.add('refresh')
  clearTimeout(timer)
  if (!paused) timer = setTimeout(() => render(current + 1), 6800)
}
document.querySelector('#next').addEventListener('click', () => render(current + 1))
document.querySelector('#back').addEventListener('click', () => render(current - 1))
document.querySelector('#replay').addEventListener('click', () => render(0))
pauseButton.addEventListener('click', () => {
  paused = !paused; clearTimeout(timer)
  pauseButton.setAttribute('aria-pressed', String(paused)); pauseButton.textContent = paused ? '▶ Resume' : 'Ⅱ Pause'
  pauseButton.setAttribute('aria-label', paused ? 'Reanudar animación' : 'Pausar animación')
  if (!paused) timer = setTimeout(() => render(current + 1), 6800)
})
render(0)
