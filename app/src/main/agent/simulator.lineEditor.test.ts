import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, LineEditorControls, ModelProvider, PermissionRequest, SuggestionRef, TrackedChangePayload } from '@shared/schema/agent'
import type { ModelCallInput } from './providers/types'

// Phase 8 §7.3: Line Editor's real branch now requests JSON-mode output
// describing multiple specific-span findings instead of one whole-selection
// rewrite (see runLineEditor() in simulator.ts). Fake out the whole
// OpenRouterAdapter module the same way simulator.realModelOutput.test.ts
// does — the point here is what runLineEditor() *does* with a
// ModelCallSummary that has outputText set (parse JSON, validate, fall back
// on failure), not the adapter's own HTTP behavior — and additionally
// capture the ModelCallInput each call receives so the control-set test
// below can assert the rendered instructions actually reached the call.
let lastInput: ModelCallInput | undefined
let nextOutputText = ''

vi.mock('./providers/openRouterAdapter', () => ({
  OpenRouterAdapter: class {
    readonly id = 'openrouter'
    supports(modelRef: { provider: string }): boolean {
      return modelRef.provider === 'openrouter'
    }
    async isAvailable(): Promise<boolean> {
      return true
    }
    async runModelCall(input: ModelCallInput): Promise<{
      modelRef: unknown
      inputTokens: number
      outputTokens: number
      estimatedCostUsd: number
      outputText: string
    }> {
      lastInput = input
      return {
        modelRef: input.modelRef,
        inputTokens: 12,
        outputTokens: 24,
        estimatedCostUsd: 0.002,
        outputText: nextOutputText
      }
    }
  }
}))

const { AgentRunManager } = await import('./simulator')
const { openIndexDb } = await import('../persistence/db')
const { setPreferredEmbeddingProvider } = await import('../retrieval/embeddings/select')
const { waitForResultStep } = await import('./simulator.testUtils')

function makeGoal(opts: {
  runId: string
  provider?: ModelProvider
  lineEditorControls?: LineEditorControls
  refinesSuggestionId?: string
  selectionText?: string
}): AgentGoal {
  const provider = opts.provider ?? 'openrouter'
  return {
    runId: opts.runId,
    agentRole: 'Line-Editor',
    modelRef:
      provider === 'openrouter'
        ? { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true }
        : { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
    userIntent: 'Send selected text to Line Editor',
    scope: { sceneIds: ['scene-1'], selectionText: opts.selectionText ?? 'The door creaked open very slowly indeed.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['line-editing']
    },
    lineEditorControls: opts.lineEditorControls,
    refinesSuggestionId: opts.refinesSuggestionId
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

function proposedChanges(steps: AgentStep[]): SuggestionRef[] {
  const resultStep = steps.find((s) => s.kind === 'result')!
  return (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
}

describe('AgentRunManager — Line Editor real JSON-mode multi-finding upgrade (Phase 8 §7.3)', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-line-editor-test-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
    lastInput = undefined
    nextOutputText = ''
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('always requests JSON-mode output from a real adapter call', async () => {
    nextOutputText = JSON.stringify({ findings: [{ category: 'Test', before: 'a', after: 'b' }] })
    const manager = new AgentRunManager(projectRoot, db)
    await runToCompletion(manager, makeGoal({ runId: 'run-line-jsonmode-1' }))

    expect(lastInput?.responseFormat?.type).toBe('json')
    expect(lastInput?.responseFormat?.instructions).toContain('findings')
  })

  it('produces multiple tracked-change suggestions from valid JSON output, threading isAiSoundingFlag and refinesSuggestionId', async () => {
    nextOutputText = JSON.stringify({
      findings: [
        { category: 'Filter word', before: 'noticed that', after: 'saw', isAiSoundingFlag: false },
        { category: 'AI-sounding phrasing', before: 'a testament to', after: 'proof of', isAiSoundingFlag: true }
      ]
    })

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-line-json-1', refinesSuggestionId: 'orig-suggestion-1' })
    const steps = await runToCompletion(manager, goal)

    const suggestions = proposedChanges(steps)
    expect(suggestions).toHaveLength(2)
    for (const s of suggestions) {
      expect(s.kind).toBe('tracked-change')
      expect(s.provenance.refinesSuggestionId).toBe('orig-suggestion-1')
    }

    const payloads = suggestions.map((s) => s.payload as TrackedChangePayload & { isAiSoundingFlag?: boolean })
    expect(payloads[0].category).toBe('Filter word')
    expect(payloads[0].isAiSoundingFlag).toBeUndefined()
    expect(payloads[1].category).toBe('AI-sounding phrasing')
    expect(payloads[1].isAiSoundingFlag).toBe(true)
  })

  it('falls back to the single whole-selection tracked-change when the real output is not valid JSON', async () => {
    nextOutputText = 'The lantern flickered once, then steadied against the draft.'

    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal({ runId: 'run-line-fallback-1' }))

    const suggestions = proposedChanges(steps)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('tracked-change')
    const payload = suggestions[0].payload as TrackedChangePayload
    expect(payload.category).toBe('Model revision')
    expect(payload.after).toBe(nextOutputText)
  })

  it('falls back to the single whole-selection tracked-change when JSON parses but findings are missing required fields', async () => {
    nextOutputText = JSON.stringify({ findings: [{ category: 'Incomplete', before: '', after: 'x' }] })

    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal({ runId: 'run-line-invalid-findings-1' }))

    const suggestions = proposedChanges(steps)
    expect(suggestions).toHaveLength(1)
    const payload = suggestions[0].payload as TrackedChangePayload
    expect(payload.category).toBe('Model revision')
  })

  it('falls back further to the fully-simulated findings when there is no real output at all', async () => {
    nextOutputText = ''
    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal({ runId: 'run-line-simulated-1' }))

    const suggestions = proposedChanges(steps)
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      const payload = s.payload as TrackedChangePayload
      expect(payload.category).not.toBe('Model revision')
    }
  })

  it('threads refinesSuggestionId through the fully-simulated fallback path too', async () => {
    nextOutputText = ''
    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({ runId: 'run-line-simulated-refine-1', refinesSuggestionId: 'orig-suggestion-2' })
    const steps = await runToCompletion(manager, goal)

    const suggestions = proposedChanges(steps)
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      expect(s.provenance.refinesSuggestionId).toBe('orig-suggestion-2')
    }
  })

  it('folds lineEditorControls (intensity, house style rules, AI-sounding flag) into the real model call instructions', async () => {
    nextOutputText = JSON.stringify({ findings: [{ category: 'Test', before: 'a', after: 'b' }] })
    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal({
      runId: 'run-line-controls-1',
      lineEditorControls: {
        intensity: 'heavy',
        houseStyleRules: ['Oxford comma always', 'No em dashes'],
        flagAiSoundingProse: true
      }
    })
    await runToCompletion(manager, goal)

    expect(lastInput?.responseFormat?.type).toBe('json')
    const instructions = lastInput?.responseFormat?.instructions ?? ''
    expect(instructions.toLowerCase()).toContain('heavy')
    expect(instructions).toContain('Oxford comma always')
    expect(instructions).toContain('No em dashes')
    expect(instructions).toContain('isAiSoundingFlag')
  })

  it('describes standard intensity by default when lineEditorControls is unset', async () => {
    nextOutputText = JSON.stringify({ findings: [{ category: 'Test', before: 'a', after: 'b' }] })
    const manager = new AgentRunManager(projectRoot, db)
    await runToCompletion(manager, makeGoal({ runId: 'run-line-controls-default-1' }))

    const instructions = lastInput?.responseFormat?.instructions ?? ''
    expect(instructions.toLowerCase()).toContain('standard')
  })

  it('still produces the old simulated multi-finding behavior unchanged via the simulator adapter', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal({ runId: 'run-line-simulator-adapter-1', provider: 'anthropic' }))

    const suggestions = proposedChanges(steps)
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      const payload = s.payload as TrackedChangePayload
      expect(payload.category).not.toBe('Model revision')
    }
  })
})
