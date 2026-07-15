import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentRunRecord, AgentStep, PermissionRequest } from '@shared/schema/agent'

// Phase 9 (Track 4) — AgentRunManager.resume(). Same real-adapter mocking
// convention as simulator.fallback.test.ts: simulator.ts's real-adapter path
// routes through OpenRouterAdapter (reads an API key via
// main/security/keyVault.ts's getSecret()), so that module is mocked before
// simulator.ts is imported.
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { AgentRunManager } = await import('./simulator')
const { openIndexDb } = await import('../persistence/db')
const { saveAgentRun } = await import('../persistence/agentRunStore')
const { setPreferredEmbeddingProvider } = await import('../retrieval/embeddings/select')
const { waitForResultStep } = await import('./simulator.testUtils')

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

// waitForResultStep (simulator.testUtils.ts) finds the FIRST 'result' step in
// a steps array — exactly right for a run's initial completion, but a
// resumed run keeps appending to the same steps array (and, once a listener
// replays history, so does a fresh subscriber's local copy), so a second
// wait needs to find the Nth 'result' step, not just any.
async function waitForNthResultStep(steps: AgentStep[], n: number, timeoutMs = 2000): Promise<AgentStep> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = steps.filter((s) => s.kind === 'result')
    if (found.length >= n) return found[n - 1]
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for result step #${n}`)
}

function makeGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    runId: 'run-resume-1',
    agentRole: 'Line-Editor',
    modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
    userIntent: 'Send selected text to Line Editor',
    scope: { sceneIds: ['scene-1'], selectionText: 'The door creaked open.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['line-editing']
    },
    ...overrides
  }
}

describe('AgentRunManager.resume()', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-resume-test-'))
    db = await openIndexDb(projectRoot)
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    vi.unstubAllGlobals()
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('reuses the exact prior in-memory budget when resuming a run this manager instance still holds', async () => {
    // The primary adapter always fails, and no LM Studio fallback is opted
    // in — the same shape simulator.fallback.test.ts uses to force a
    // recoverable 'paused' finish via ModelCallFailure.
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new AgentRunManager(projectRoot, db)
    // maxToolCalls: 1 is the load-bearing constraint here — Line Editor's
    // real tool call (word-count) happens and increments toolCallsUsed to 1
    // *before* the model-call attempt that then fails and pauses the run.
    const goal = makeGoal({ constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 1, maxElapsedMs: 30000, allowedCapabilityCategories: ['line-editing'] } })

    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const permissionStep = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, permissionStep.requestId, 'approved-once')
    const firstResult = await waitForResultStep(steps)
    expect((firstResult.detail as { warnings?: string[] }).warnings).toContain('model-call-failed')
    // toolCallsUsed is now 1 in the in-memory RunState still held by `manager`.

    manager.resume(goal.runId)

    // The restarted execute() re-requests permission from scratch (no
    // session approval was granted the first time — 'approved-once' doesn't
    // grant one). Find that new pending request: it's the one whose
    // requestId never appears with a resolved decision elsewhere in the
    // steps array (the first request's decided entry is a separate, later
    // AgentStep — the earlier 'pending' entry for it is never mutated).
    // Poll briefly since resume()'s synchronous reuse path emits it before
    // its own promise settles, but a grace window is safer than assuming
    // that timing exactly.
    const deadline = Date.now() + 2000
    let pending: PermissionRequest | undefined
    while (Date.now() < deadline) {
      const candidates = steps.filter((s) => s.kind === 'permission-request').map((s) => s.detail as PermissionRequest)
      pending = candidates.find(
        (r) => r.decision === 'pending' && !candidates.some((other) => other.requestId === r.requestId && other.decision !== 'pending')
      )
      if (pending) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(pending).toBeDefined()
    manager.respondToPermission(goal.runId, pending!.requestId, 'approved-once')

    const secondResult = await waitForNthResultStep(steps, 2)
    const result = secondResult.detail as { summary: string; warnings?: string[] }

    // If the resumed run had reset toolCallsUsed to 0 instead of reusing the
    // prior budget, this second attempt would make its own first tool call
    // (0 + 1 = 1, not over the cap) and proceed to fail the model call again
    // ('paused', warnings containing 'model-call-failed'). Instead, reusing
    // the prior toolCallsUsed=1 means the very next guardToolCall check
    // (1 + 1 = 2 > 1) trips immediately — proving the exact prior budget was
    // reused, not reset.
    expect(result.summary).toBe('Line Editor stopped: tool-call budget (1) reached before a result could be produced.')
    expect(result.warnings).toContain('budget-exceeded')
  })

  it('reconstructs an accurate budget from disk when resuming a run this manager instance has never seen', async () => {
    const runId = 'run-resume-disk-1'
    const goal = makeGoal({
      runId,
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 5, maxElapsedMs: 30000, allowedCapabilityCategories: ['line-editing'] }
    })

    const now = new Date().toISOString()
    const persistedRecord: AgentRunRecord = {
      schemaVersion: 1,
      goal,
      status: 'paused',
      startedAt: now,
      endedAt: now,
      steps: [
        { stepIndex: 0, kind: 'plan', timestamp: now, detail: { summary: 'plan' } },
        { stepIndex: 1, kind: 'tool-call', timestamp: now, detail: { toolId: 'global.tools.line-edit-scan@1.0.0', input: {}, output: {} } },
        { stepIndex: 2, kind: 'tool-call', timestamp: now, detail: { toolId: 'global.tools.word-count@1.0.0', input: {}, output: {} } },
        {
          stepIndex: 3,
          kind: 'model-call',
          timestamp: now,
          detail: { modelRef: goal.modelRef, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.02 }
        },
        { stepIndex: 4, kind: 'result', timestamp: now, detail: { summary: 'paused', warnings: ['model-call-failed'] } }
      ]
    }
    await saveAgentRun(projectRoot, db, persistedRecord)

    // A brand-new manager instance — its `runs` map has never held this run.
    const manager = new AgentRunManager(projectRoot, db)

    await manager.resume(runId)

    const reconstructed = (
      manager as unknown as {
        runs: Map<string, { budget: { tokensUsed: number; costUsdUsed: number; turnsUsed: number; toolCallsUsed: number } }>
      }
    ).runs.get(runId)

    expect(reconstructed).toBeDefined()
    // One persisted model-call step: 100 + 50 tokens, $0.02, 1 turn.
    expect(reconstructed!.budget.tokensUsed).toBe(150)
    expect(reconstructed!.budget.costUsdUsed).toBeCloseTo(0.02)
    expect(reconstructed!.budget.turnsUsed).toBe(1)
    // Two persisted tool-call steps.
    expect(reconstructed!.budget.toolCallsUsed).toBe(2)

    // Sanity: the manager is still fully usable after reconstruction — let
    // the restarted run finish so nothing is left hanging.
    const steps: AgentStep[] = []
    manager.onStep(runId, (step) => steps.push(step))
    const pendingRequest = () =>
      steps.filter((s) => s.kind === 'permission-request').map((s) => s.detail as PermissionRequest).find((r) => r.decision === 'pending')

    const deadline = Date.now() + 2000
    let pending: PermissionRequest | undefined
    while (Date.now() < deadline) {
      pending = pendingRequest()
      if (pending) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(pending).toBeDefined()
    manager.respondToPermission(runId, pending!.requestId, 'approved-once')

    const finalResult = await waitForNthResultStep(steps, 2)
    const result = finalResult.detail as { summary: string; warnings?: string[] }
    expect(result.warnings ?? []).not.toContain('model-call-failed')
  })

  it('throws when asked to resume a run that is not paused', async () => {
    const runId = 'run-resume-not-paused'
    const goal = makeGoal({ runId, modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false } })
    const now = new Date().toISOString()
    const persistedRecord: AgentRunRecord = {
      schemaVersion: 1,
      goal,
      status: 'completed',
      startedAt: now,
      endedAt: now,
      steps: []
    }
    await saveAgentRun(projectRoot, db, persistedRecord)

    const manager = new AgentRunManager(projectRoot, db)
    await expect(manager.resume(runId)).rejects.toThrow(/not paused/i)
  })
})
