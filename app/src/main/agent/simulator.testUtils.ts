import { rmSync } from 'node:fs'
import type { AgentStep } from '@shared/schema/agent'

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

// Test cleanup for a temp project/userData directory, retrying past a real
// (not hypothetical) race: `recordModelCall()` in simulator.ts fires off
// `recordUsage()` without awaiting it — a deliberate "never block or throw"
// contract shared by every real-tool call in that file. A test that awaits
// the run's `result` step and immediately tears down its temp dir can still
// race that in-flight write: Node's recursive `rmSync` snapshots a
// directory's entries via readdir, deletes each one, then rmdirs it, so a
// usage-log file created after the snapshot (or mid-delete) causes an
// ENOTEMPTY on Windows. This was previously seen as an occasional flake in
// one file's local runs; a slower/more-contended CI Windows runner hits it
// far more reliably, across every test file that does real fs-backed work.
// Retrying with a short backoff is simpler and less invasive than adding a
// synchronization point to the production fire-and-forget contract, which
// several rounds of this codebase have deliberately kept simple.
export function cleanupTestDir(path: string, attempts = 5): void {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt === attempts || (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM')) {
        throw err
      }
      const deadline = Date.now() + 25 * attempt
      while (Date.now() < deadline) {
        // Deliberately synchronous busy-wait: this runs inside a
        // (non-async) afterEach/afterAll hook in most call sites, so an
        // async delay would require converting every hook to async just
        // for a ~25-125ms total backoff window.
      }
    }
  }
}
