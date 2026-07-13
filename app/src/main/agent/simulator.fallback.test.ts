import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, ModelCallSummary, PermissionRequest } from '@shared/schema/agent'

// simulator.ts's real-adapter path routes through OpenRouterAdapter (which
// reads an API key via main/security/keyVault.ts's getSecret()) and, on
// fallback, LmStudioAdapter — both real fetch-based adapters (see
// providers/openRouterAdapter.test.ts for the same mocking convention this
// file follows). Neither 'electron' nor promptStore need mocking: simulator
// ts's runModelCallStep() wraps its getActivePrompt() call in a try/catch
// and falls back to no system prompt when it throws (e.g. no Electron `app`
// available in a plain vitest/node process).
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const { AgentRunManager } = await import('./simulator')
const { openIndexDb } = await import('../persistence/db')
const { waitForResultStep } = await import('./simulator.testUtils')

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const LM_STUDIO_MODELS_URL = 'http://localhost:1234/v1/models'
const LM_STUDIO_CHAT_URL = 'http://localhost:1234/v1/chat/completions'

function makeGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    runId: 'run-fallback-1',
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

async function runToCompletion(manager: InstanceType<typeof AgentRunManager>, goal: AgentGoal): Promise<AgentStep[]> {
  const steps: AgentStep[] = []
  manager.start(goal)
  manager.onStep(goal.runId, (step) => steps.push(step))

  const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
  manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
  await waitForResultStep(steps)
  return steps
}

describe('AgentRunManager — real-adapter model-call fallback (Phase 6)', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-fallback-test-'))
    db = await openIndexDb(projectRoot)
    getSecretMock.mockReset()
    getSecretMock.mockResolvedValue('sk-or-test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('ends the run paused when the primary adapter fails and lmStudioFallback is unset', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      throw new Error(`unexpected fetch to ${url} — LM Studio should never be reached`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-fallback-none', lmStudioFallback: undefined })
    const steps = await runToCompletion(manager, goal)

    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)
    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { summary: string; warnings?: string[] }
    expect(result.warnings).toContain('model-call-failed')

    // Only the primary adapter was ever called — LM Studio was never touched.
    expect(fetchMock.mock.calls.every(([url]) => url === OPENROUTER_CHAT_URL)).toBe(true)
  })

  it('completes normally via the LM Studio fallback when the primary fails, fallback is opted in, and LM Studio is available', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      if (url === LM_STUDIO_MODELS_URL) return Promise.resolve(new Response('{}', { status: 200 }))
      if (url === LM_STUDIO_CHAT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Revised: the door swung open.' } }],
              usage: { prompt_tokens: 12, completion_tokens: 8 }
            }),
            { status: 200 }
          )
        )
      }
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-fallback-success', lmStudioFallback: true })
    const steps = await runToCompletion(manager, goal)

    const modelCallStep = steps.find((s) => s.kind === 'model-call')
    expect(modelCallStep).toBeDefined()
    const modelCall = modelCallStep!.detail as ModelCallSummary
    expect(modelCall.modelRef).toEqual({ provider: 'lm-studio', modelId: 'local-fallback', viaOpenRouter: false })
    expect(modelCall.outputText).toBe('Revised: the door swung open.')

    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { summary: string; warnings?: string[] }
    expect(result.warnings ?? []).not.toContain('model-call-failed')
    expect(result.warnings ?? []).not.toContain('fallback-unavailable')
    expect(result.summary).toMatch(/Line Editor found/)
  })

  it('ends the run paused when the primary fails, fallback is opted in, but LM Studio is unavailable', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      if (url === LM_STUDIO_MODELS_URL) return Promise.reject(new Error('ECONNREFUSED'))
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-fallback-unavailable', lmStudioFallback: true })
    const steps = await runToCompletion(manager, goal)

    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)
    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { summary: string; warnings?: string[] }
    expect(result.warnings).toContain('fallback-unavailable')
  })

  it('ends the run paused (not error) when LM Studio is available but its own completion call fails', async () => {
    // Regression test for a Codex adversarial-review finding: isAvailable()
    // passing doesn't guarantee the actual chat-completion call succeeds. An
    // un-rethrown failure here used to skip the ModelCallFailure branch in
    // start()'s catch entirely, ending the run 'error' instead of the
    // intended recoverable 'paused'.
    const fetchMock = vi.fn((url: string) => {
      if (url === OPENROUTER_CHAT_URL) return Promise.reject(new Error('ECONNREFUSED'))
      if (url === LM_STUDIO_MODELS_URL) return Promise.resolve(new Response('{}', { status: 200 }))
      if (url === LM_STUDIO_CHAT_URL) return Promise.resolve(new Response('server error', { status: 500 }))
      throw new Error(`unexpected fetch to ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-fallback-itself-fails', lmStudioFallback: true })
    const steps = await runToCompletion(manager, goal)

    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)
    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { summary: string; warnings?: string[] }
    expect(result.warnings).toContain('fallback-failed')
  })
})
