import type { AgentStep } from '@shared/schema/agent'

export { cleanupTestDir } from '../testUtils'

// Deterministically wait for the AgentRunManager to emit its asynchronous
// `result` step, instead of assuming a fixed number of event-loop ticks after
// the permission response. Several agent roles now do real fs-backed work
// (contradiction checks, codex search, scene lookups) between the permission
// response and the result step, crossing an unpredictable number of turns — a
// fixed `setTimeout(0|50|60)` raced that work and flaked intermittently. Poll
// instead, with a generous cap so a genuine hang still fails loudly.
export async function waitForResultStep(steps: AgentStep[], timeoutMs = 2000): Promise<AgentStep> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = steps.find((s) => s.kind === 'result')
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for a 'result' step")
}
