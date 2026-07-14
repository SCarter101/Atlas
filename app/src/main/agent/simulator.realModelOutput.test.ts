import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentGoal,
  AgentRole,
  AgentStep,
  InsertionPayload,
  ModelProvider,
  PermissionRequest,
  SuggestionRef,
  TrackedChangePayload
} from '@shared/schema/agent'

// Phase 6: when a real provider adapter actually returns outputText,
// runGenerator/runLineEditor should emit a suggestion built from that real
// text instead of the deterministic simulated one. Fake out the whole
// OpenRouterAdapter module (same technique openRouterAdapter.test.ts uses
// for keyVault, one level up) rather than hitting a real network — the point
// of this test is what simulator.ts *does* with a ModelCallSummary that has
// outputText set, not the adapter's own HTTP behavior (already covered by
// providers/openRouterAdapter.test.ts).
const FAKE_OUTPUT_TEXT = 'The lantern flickered once, then steadied against the draft.'

vi.mock('./providers/openRouterAdapter', () => ({
  OpenRouterAdapter: class {
    readonly id = 'openrouter'
    supports(modelRef: { provider: string }): boolean {
      return modelRef.provider === 'openrouter'
    }
    async isAvailable(): Promise<boolean> {
      return true
    }
    async runModelCall(input: { modelRef: unknown }): Promise<{
      modelRef: unknown
      inputTokens: number
      outputTokens: number
      estimatedCostUsd: number
      outputText: string
    }> {
      return {
        modelRef: input.modelRef,
        inputTokens: 12,
        outputTokens: 24,
        estimatedCostUsd: 0.002,
        outputText: FAKE_OUTPUT_TEXT
      }
    }
  }
}))

const { AgentRunManager } = await import('./simulator')
const { openIndexDb } = await import('../persistence/db')
const { setPreferredEmbeddingProvider } = await import('../retrieval/embeddings/select')
const { waitForResultStep } = await import('./simulator.testUtils')

function makeGoal(agentRole: AgentRole, provider: ModelProvider, runId: string): AgentGoal {
  return {
    runId,
    agentRole,
    modelRef:
      provider === 'openrouter'
        ? { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true }
        : { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
    userIntent: `Send selected text to ${agentRole}`,
    scope: { sceneIds: ['scene-1'], selectionText: 'The door creaked open.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['line-editing']
    }
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

describe('AgentRunManager — real model output consumption (Phase 6)', () => {
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-real-output-test-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  describe('Generator', () => {
    it('emits exactly one insertion built from real model output when the adapter is real', async () => {
      const manager = new AgentRunManager(projectRoot, db)
      const goal = makeGoal('Generator', 'openrouter', 'run-real-generator')
      const steps = await runToCompletion(manager, goal)

      const suggestions = proposedChanges(steps)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].kind).toBe('insertion')
      const payload = suggestions[0].payload as InsertionPayload
      expect(payload.text).toBe(FAKE_OUTPUT_TEXT)
      expect(payload.draftGroupId).toBeUndefined()

      // Phase 7: assembledContext.usedTokens must be the real adapter-
      // reported inputTokens (12, per the fake OpenRouterAdapter above), not
      // assemble.ts's own pre-call estimate — more honest once a real call
      // has actually completed.
      const modelCallStep = steps.find((s) => s.kind === 'model-call')!.detail as {
        inputTokens: number
        assembledContext?: { usedTokens: number; tokenBudget: number }
      }
      expect(modelCallStep.assembledContext).toBeDefined()
      expect(modelCallStep.assembledContext?.usedTokens).toBe(12)
      expect(modelCallStep.assembledContext?.usedTokens).toBe(modelCallStep.inputTokens)
    })

    it('still produces the old simulated multi-draft-capable behavior unchanged via the simulator adapter', async () => {
      const manager = new AgentRunManager(projectRoot, db)
      const goal = makeGoal('Generator', 'anthropic', 'run-simulated-generator')
      const steps = await runToCompletion(manager, goal)

      const suggestions = proposedChanges(steps)
      expect(suggestions).toHaveLength(1)
      const payload = suggestions[0].payload as InsertionPayload
      // The deterministic simulated continuation never equals the fake real
      // adapter's output — this is the "old behavior is unchanged" check.
      expect(payload.text).not.toBe(FAKE_OUTPUT_TEXT)
      expect(payload.text.length).toBeGreaterThan(0)
    })
  })

  describe('Line Editor', () => {
    // Phase 8 §7.3 + Codex adversarial-review: Line Editor's real branch now
    // always requests JSON-mode multi-finding output (see
    // simulator.lineEditor.test.ts for that upgrade's own coverage).
    // FAKE_OUTPUT_TEXT here is plain prose, not JSON, so this exercises the
    // JSON-parse-failure path — which must fall all the way through to the
    // fully-simulated findings, NOT offer the raw model text as a
    // whole-selection replacement (a real model's non-JSON response to a
    // JSON-mode request is typically explanatory prose or a malformed
    // fragment, neither of which is safe to present as literal replacement
    // prose).
    it('falls back to the fully-simulated findings when the real adapter does not return valid JSON', async () => {
      const manager = new AgentRunManager(projectRoot, db)
      const goal = makeGoal('Line-Editor', 'openrouter', 'run-real-line-editor')
      const steps = await runToCompletion(manager, goal)

      const suggestions = proposedChanges(steps)
      expect(suggestions.length).toBeGreaterThan(0)
      for (const s of suggestions) {
        const payload = s.payload as TrackedChangePayload
        expect(payload.category).not.toBe('Model revision')
        expect(payload.after).not.toBe(FAKE_OUTPUT_TEXT)
      }
    })

    it('still produces the old simulated multi-finding behavior unchanged via the simulator adapter', async () => {
      const manager = new AgentRunManager(projectRoot, db)
      const goal = makeGoal('Line-Editor', 'anthropic', 'run-simulated-line-editor')
      const steps = await runToCompletion(manager, goal)

      const suggestions = proposedChanges(steps)
      expect(suggestions.length).toBeGreaterThan(0)
      for (const s of suggestions) {
        const payload = s.payload as TrackedChangePayload
        expect(payload.category).not.toBe('Model revision')
        expect(payload.after).not.toBe(FAKE_OUTPUT_TEXT)
      }
    })
  })
})
