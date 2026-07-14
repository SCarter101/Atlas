import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentGoal,
  AgentStep,
  EditorialFindingPayload,
  InsertionPayload,
  PermissionRequest,
  SuggestionRef
} from '@shared/schema/agent'
import type { SceneMeta } from '@shared/schema/manuscript'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { writeScene } from '../persistence/sceneStore'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'
import type { ModelCallInput } from './providers/types'
import { waitForResultStep } from './simulator.testUtils'

// Phase 8 §7.1: capture the ModelCallInput a "real" adapter call receives so
// the style-guidance test below can assert the writer's generatorControls
// (and any style-sample text) actually reached userIntent, not just that a
// run completed — same fake-adapter technique
// simulator.realModelOutput.test.ts already uses, extended to record the
// input rather than only returning a fixed output.
let lastInput: ModelCallInput | undefined
let nextOutputText = 'A lantern swung once in the draft, then steadied.'

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

const BASE_META: SceneMeta = {
  schemaVersion: 1,
  id: 'scene-1',
  chapterId: 'chapter-1',
  order: 0,
  title: 'Test Scene',
  wordCount: 0,
  status: 'drafting',
  updatedAt: new Date().toISOString()
}

function makeGoal(generateAlternatives?: boolean): AgentGoal {
  return {
    runId: 'run-generator-1',
    agentRole: 'Generator',
    modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
    userIntent: 'Send selected text to Generator',
    scope: { sceneIds: ['scene-1'], selectionText: 'The door creaked open.' },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['generation']
    },
    generateAlternatives
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

describe('AgentRunManager — Generator opt-in multi-draft mode', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-generator-test-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('produces exactly one draft with no draftGroupId when generateAlternatives is unset', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal(undefined))

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions).toHaveLength(1)
    expect((suggestions[0].payload as InsertionPayload).draftGroupId).toBeUndefined()
  })

  it('produces multiple drafts sharing one draftGroupId when generateAlternatives is true', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal(true))

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions.length).toBeGreaterThan(1)

    const payloads = suggestions.map((s) => s.payload as InsertionPayload)
    const groupIds = new Set(payloads.map((p) => p.draftGroupId))
    expect(groupIds.size).toBe(1)
    expect([...groupIds][0]).toBeDefined()

    // Every draft's text should actually differ — otherwise "compare
    // side-by-side" would show nothing but three identical cards.
    const texts = new Set(payloads.map((p) => p.text))
    expect(texts.size).toBe(payloads.length)
  })
})

describe('AgentRunManager — Generator control set & clarifying questions (Phase 8 §7.1)', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-generator-phase8-'))
    db = await openIndexDb(projectRoot)
    setPreferredEmbeddingProvider('hashing')
    lastInput = undefined
    nextOutputText = 'A lantern swung once in the draft, then steadied.'
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('folds generatorControls into the real model call as a Style guidance block', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal: AgentGoal = {
      runId: 'run-generator-style-1',
      agentRole: 'Generator',
      modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
      userIntent: 'Send selected text to Generator',
      scope: { sceneIds: ['scene-1'], selectionText: 'The door creaked open.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      },
      generatorControls: {
        tone: 'wry',
        pacing: 'fast',
        styleSampleText: 'The rain fell sideways, unimpressed by anyone’s plans.'
      }
    }

    await runToCompletion(manager, goal)

    expect(lastInput).toBeDefined()
    expect(lastInput?.userIntent).toContain('Style guidance:')
    expect(lastInput?.userIntent).toContain('Tone: wry.')
    expect(lastInput?.userIntent).toContain('Pacing: fast.')
    expect(lastInput?.userIntent).toContain('Match the voice of this sample:')
    expect(lastInput?.userIntent).toContain('The rain fell sideways')
    // No responseFormat here — Generator's real output stays free-form
    // prose, unlike Line Editor's Phase 8 JSON-mode upgrade.
    expect(lastInput?.responseFormat).toBeUndefined()
  })

  it('leaves userIntent unchanged when generatorControls is unset', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal: AgentGoal = {
      runId: 'run-generator-style-2',
      agentRole: 'Generator',
      modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
      userIntent: 'Send selected text to Generator',
      scope: { sceneIds: ['scene-1'], selectionText: 'The door creaked open.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      }
    }

    await runToCompletion(manager, goal)

    expect(lastInput?.userIntent).toBe('Send selected text to Generator')
  })

  it('asks a clarifying question instead of drafting when the selection is empty and the scene has no stated purpose', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal: AgentGoal = {
      runId: 'run-generator-clarify-1',
      agentRole: 'Generator',
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      userIntent: 'Send selected text to Generator',
      scope: { sceneIds: ['scene-1'], selectionText: '' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      }
    }

    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('editorial-finding')
    expect(suggestions[0].agentRole).toBe('Generator')
    const payload = suggestions[0].payload as EditorialFindingPayload
    expect(payload.title.length).toBeGreaterThan(0)

    // Drafting was skipped entirely — no tool call or model call should have
    // been made for a run that never got past "there's nothing to work with."
    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)
    expect(steps.some((s) => s.kind === 'model-call')).toBe(false)
  })

  it('threads refinesSuggestionId onto a clarifying-question suggestion', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal: AgentGoal = {
      runId: 'run-generator-clarify-refine-1',
      agentRole: 'Generator',
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      userIntent: 'Send selected text to Generator',
      scope: { sceneIds: ['scene-1'], selectionText: '  ' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      },
      refinesSuggestionId: 'orig-suggestion-9'
    }

    const steps = await runToCompletion(manager, goal)
    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions[0].provenance.refinesSuggestionId).toBe('orig-suggestion-9')
  })

  it('does not ask a clarifying question when the selection is short but the scene has a stated purpose', async () => {
    await writeScene(
      projectRoot,
      db,
      'scene-1',
      { meta: { ...BASE_META, purpose: "Ray confronts his brother about the missing ledger." }, prose: 'Draft prose.' },
      'book-1/part-1/chapter-1',
      'scene-1'
    )

    const manager = new AgentRunManager(projectRoot, db)
    const goal: AgentGoal = {
      runId: 'run-generator-clarify-2',
      agentRole: 'Generator',
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      userIntent: 'Send selected text to Generator',
      scope: { sceneIds: ['scene-1'], selectionText: 'Continue.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['generation']
      }
    }

    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('insertion')
  })

  it('does not ask a clarifying question on an ordinary selection long enough to draft from', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps = await runToCompletion(manager, makeGoal(undefined))

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    expect(suggestions[0].kind).toBe('insertion')
  })
})
