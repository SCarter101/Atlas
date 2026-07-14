import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep } from '@shared/schema/agent'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'
import { AgentRunManager, detectDuplicateAction } from './simulator'
import { waitForResultStep } from './simulator.testUtils'

describe('detectDuplicateAction', () => {
  it('is false until a signature would be the threshold-th occurrence', () => {
    expect(detectDuplicateAction([], 'a')).toBe(false)
    expect(detectDuplicateAction(['a'], 'a')).toBe(false)
    expect(detectDuplicateAction(['a', 'a'], 'a')).toBe(true)
  })

  it('only counts occurrences of the matching signature', () => {
    expect(detectDuplicateAction(['a', 'b', 'a'], 'b')).toBe(false)
    expect(detectDuplicateAction(['b', 'a', 'b'], 'b')).toBe(true)
  })

  it('respects a custom threshold', () => {
    expect(detectDuplicateAction(['a', 'a', 'a'], 'a', 5)).toBe(false)
    expect(detectDuplicateAction(['a', 'a', 'a', 'a'], 'a', 5)).toBe(true)
  })
})

describe('AgentRunManager — budget enforcement', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-test-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: assembleContext()'s Codex-search step resolves a real
    // embedding provider by default (getPreferredEmbeddingProvider() ??
    // 'lm-studio', same as the retrieval:search IPC handler) — force the
    // network-free hashing adapter so this test never depends on (or is
    // slowed down by) a real local LM Studio instance that may actually be
    // running on the machine running this suite.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(overrides: Partial<AgentGoal['constraints']> = {}): AgentGoal {
    return {
      runId: 'run-budget-1',
      agentRole: 'Line-Editor',
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      userIntent: 'Send selected text to Line Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Some selected prose.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['line-editing'],
        ...overrides
      }
    }
  }

  it('stops immediately with a clear message and no tool-call step when maxToolCalls is 0', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal({ maxToolCalls: 0 })

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const permissionStep = steps.find((s) => s.kind === 'permission-request')
    const requestId = (permissionStep!.detail as { requestId: string }).requestId
    manager.respondToPermission(goal.runId, requestId, 'approved-once')
    await waitForResultStep(steps)

    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)
    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)

    const resultStep = steps.find((s) => s.kind === 'result')
    expect(resultStep).toBeDefined()
    const result = resultStep!.detail as { summary: string; warnings?: string[] }
    expect(result.summary).toBe('Line Editor stopped: tool-call budget (0) reached before a result could be produced.')
    expect(result.warnings).toContain('budget-exceeded')
  })

  it('stops with a distinct message from permission-denied when maxTokens is exceeded before the model call', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    // 1 tool call is allowed, but the token ceiling is set low enough that
    // even the smallest simulated model call would exceed it.
    const goal = makeGoal({ maxToolCalls: 3, maxTokens: 1 })

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const permissionStep = steps.find((s) => s.kind === 'permission-request')
    const requestId = (permissionStep!.detail as { requestId: string }).requestId
    manager.respondToPermission(goal.runId, requestId, 'approved-once')
    await waitForResultStep(steps)

    expect(steps.some((s) => s.kind === 'tool-call')).toBe(true)
    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)

    const resultStep = steps.find((s) => s.kind === 'result')
    const result = resultStep!.detail as { summary: string; warnings?: string[] }
    expect(result.summary).toContain('token budget (1) would be exceeded')
    expect(result.summary).not.toContain('Permission denied')
  })
})
