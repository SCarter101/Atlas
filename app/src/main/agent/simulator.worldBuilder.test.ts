import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import { emptyWorldBuilderInterviewAnswers, encodeWorldBuilderInterview } from '@shared/worldBuilderInterview'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'

// Phase 8 §7.5: when a real provider adapter actually returns JSON-mode
// outputText, runWorldBuilder's real branch should parse it into real Codex
// proposals instead of the deterministic deriveWorldBuilderProposals/
// simulateCodexAdditions templates. Fake out the whole OpenRouterAdapter
// module rather than hitting a real network — same technique
// simulator.realModelOutput.test.ts uses for Generator/Line-Editor.
let fakeOutputText = ''
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
        outputText: fakeOutputText
      }
    }
  }
}))

const { AgentRunManager, deriveWorldBuilderProposals, parseRealWorldBuilderProposals } = await import('./simulator')

// The simulator emits its `result` step asynchronously after a permission
// response, so a fixed `setTimeout(0)` occasionally samples `steps` before the
// result lands (flaky). Poll for the step instead — deterministic, with a
// generous cap so a genuine hang still fails rather than waiting forever.
async function waitForStep(steps: AgentStep[], kind: AgentStep['kind']): Promise<AgentStep> {
  for (let i = 0; i < 200; i++) {
    const found = steps.find((s) => s.kind === kind)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for a '${kind}' step`)
}

describe('deriveWorldBuilderProposals — pure interview-to-Codex-proposals derivation', () => {
  it('proposes exactly the always-on world-rule and location entries when the rest of the interview is blank', () => {
    const proposals = deriveWorldBuilderProposals(emptyWorldBuilderInterviewAnswers())
    expect(proposals).toHaveLength(2)
    const types = proposals.map((p) => (p.payload as { entryType: string }).entryType)
    expect(types).toEqual(['world-rule', 'location'])
  })

  it('every proposal is a pending World-Builder codex-addition citing the writer\'s own answers', () => {
    const proposals = deriveWorldBuilderProposals(emptyWorldBuilderInterviewAnswers())
    for (const p of proposals) {
      expect(p.agentRole).toBe('World-Builder')
      expect(p.kind).toBe('codex-addition')
      expect(p.state).toBe('pending')
      const payload = p.payload as { citations: { reliability: string }[] }
      expect(payload.citations[0].reliability).toBe('author-stated')
    }
  })

  it('adds a social-structure entry once character-impact or plot-pressure answers are given', () => {
    const answers = { ...emptyWorldBuilderInterviewAnswers(), characterImpact: 'It grinds down anyone without money.' }
    const proposals = deriveWorldBuilderProposals(answers)
    expect(proposals).toHaveLength(3)
    expect((proposals[2].payload as { entryType: string }).entryType).toBe('faction')
  })

  it('adds a timeline entry only once the plot-pressure answer is substantial, capping at 4 proposals', () => {
    // A short plot-pressure answer is still non-empty, so it triggers the
    // social-structure entry (condition: impact || pressure) but not the
    // separate timeline entry, which requires a longer answer.
    const shortPressure = { ...emptyWorldBuilderInterviewAnswers(), plotPressure: 'A deadline.' }
    expect(deriveWorldBuilderProposals(shortPressure)).toHaveLength(3)

    const longPressure = {
      ...emptyWorldBuilderInterviewAnswers(),
      characterImpact: 'Everyone owes someone.',
      plotPressure: 'A shipment deadline nobody in the three families can afford to move or renegotiate.'
    }
    const proposals = deriveWorldBuilderProposals(longPressure)
    expect(proposals).toHaveLength(4)
    expect(proposals.length).toBeLessThanOrEqual(4)
  })

  it('avoids proposing two entries of the same type for historical-setting (social-structure entry is already timeline-item)', () => {
    const answers = {
      ...emptyWorldBuilderInterviewAnswers(),
      genreTemplate: 'historical-setting' as const,
      characterImpact: 'Rationing shapes every relationship in the village.',
      plotPressure: 'The war is entering its fourth year and supplies are nearly gone for everyone involved.'
    }
    const proposals = deriveWorldBuilderProposals(answers)
    expect(proposals).toHaveLength(4)
    const types = proposals.map((p) => (p.payload as { entryType: string }).entryType)
    expect(types[2]).toBe('timeline-item')
    expect(types[3]).toBe('faction')
    expect(new Set(types).size).toBe(types.length)
  })

  it('carries the target scene id through to every proposal when one is provided', () => {
    const proposals = deriveWorldBuilderProposals(emptyWorldBuilderInterviewAnswers(), 'scene-042')
    expect(proposals.every((p) => p.targetSceneId === 'scene-042')).toBe(true)
  })
})

describe('AgentRunManager — World Builder interview flow', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-worldbuilder-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale. Only the
    // non-interview (plain-selection) flow below actually reaches
    // assembleContext()'s full retrieval path, but this is harmless either
    // way.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(selectionText: string): AgentGoal {
    return {
      runId: 'run-world-builder-1',
      agentRole: 'World-Builder',
      modelRef: { provider: 'anthropic', modelId: 'gemini-1.5-pro', viaOpenRouter: false },
      userIntent: 'Run World Builder interview for a Fantasy kingdom',
      scope: { sceneIds: ['scene-002'], selectionText },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['world-research']
      }
    }
  }

  it('proposes multiple Codex entries from a completed interview, distinct from the single-guess selection flow', async () => {
    const answers = {
      ...emptyWorldBuilderInterviewAnswers(),
      genreTemplate: 'fantasy-kingdom' as const,
      worldGrounding: 'A mountain kingdom cut off from the coast by an ancient magical barrier.',
      consistencyFacts: 'The barrier has never once failed in a thousand years.',
      characterImpact: 'Nobody who lives here has ever seen the ocean.',
      plotPressure: 'The barrier is now failing, and no one in living memory knows how to repair it.'
    }
    const goal = makeGoal(encodeWorldBuilderInterview(answers))

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')

    const resultStep = await waitForStep(steps, 'result')
    expect(resultStep).toBeDefined()
    const result = resultStep!.detail as { proposedCodexChanges?: SuggestionRef[] }
    expect(result.proposedCodexChanges?.length).toBeGreaterThanOrEqual(2)
    expect(result.proposedCodexChanges?.length).toBeLessThanOrEqual(4)
    for (const suggestion of result.proposedCodexChanges ?? []) {
      const payload = suggestion.payload as { citations: { reliability: string }[] }
      expect(payload.citations[0].reliability).toBe('author-stated')
    }
  })

  it('falls back to the original single-guess flow for a plain manuscript selection (no interview marker)', async () => {
    const goal = makeGoal('The Bronco idled outside the old harbor gate.')

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')

    const resultStep = await waitForStep(steps, 'result')
    const result = resultStep!.detail as { proposedCodexChanges?: SuggestionRef[] }
    expect(result.proposedCodexChanges).toHaveLength(1)
    const payload = result.proposedCodexChanges![0].payload as { citations: { reliability: string }[] }
    expect(payload.citations[0].reliability).toBe('low')
  })
})

describe('parseRealWorldBuilderProposals — pure JSON-response validator', () => {
  it('accepts a well-formed proposals array with valid CodexEntryType values', () => {
    const result = parseRealWorldBuilderProposals({
      proposals: [
        { entryType: 'location', name: 'The Sundered Vale', summary: 'A valley split by an old war.' },
        { entryType: 'faction', name: 'The Ashguard', summary: 'Keepers of the barrier.' }
      ]
    })
    expect(result).toEqual([
      { entryType: 'location', name: 'The Sundered Vale', summary: 'A valley split by an old war.' },
      { entryType: 'faction', name: 'The Ashguard', summary: 'Keepers of the barrier.' }
    ])
  })

  it('caps at 4 proposals even when the model returns more', () => {
    const result = parseRealWorldBuilderProposals({
      proposals: Array.from({ length: 6 }, (_, i) => ({
        entryType: 'location',
        name: `Place ${i}`,
        summary: `Summary ${i}`
      }))
    })
    expect(result).toHaveLength(4)
  })

  it('rejects an entryType that is not a real CodexEntryType', () => {
    const result = parseRealWorldBuilderProposals({
      proposals: [{ entryType: 'made-up-type', name: 'Something', summary: 'A summary.' }]
    })
    expect(result).toBeUndefined()
  })

  it('rejects an empty proposals array and malformed shapes', () => {
    expect(parseRealWorldBuilderProposals({ proposals: [] })).toBeUndefined()
    expect(parseRealWorldBuilderProposals(undefined)).toBeUndefined()
    expect(parseRealWorldBuilderProposals({})).toBeUndefined()
    expect(
      parseRealWorldBuilderProposals({ proposals: [{ entryType: 'location', name: '', summary: 'A summary.' }] })
    ).toBeUndefined()
  })
})

describe('AgentRunManager — World Builder real-model-output branch (Phase 8)', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-worldbuilder-real-'))
    db = await openIndexDb(projectRoot)
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    fakeOutputText = ''
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeOpenRouterGoal(selectionText: string, refinesSuggestionId?: string): AgentGoal {
    return {
      runId: 'run-world-builder-real-1',
      agentRole: 'World-Builder',
      modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
      userIntent: 'Propose new Codex entries for this passage',
      scope: { sceneIds: ['scene-002'], selectionText },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['world-research']
      },
      refinesSuggestionId
    }
  }

  it('parses well-formed JSON into real Codex proposals for a plain selection, keeping the honest low-reliability citation and threading refinesSuggestionId through', async () => {
    fakeOutputText = JSON.stringify({
      proposals: [
        { entryType: 'location', name: 'Harborgate', summary: 'A weathered port town on the strait.' },
        { entryType: 'faction', name: 'The Bronco Crew', summary: 'Smugglers who idle outside the gate.' }
      ]
    })

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal('The Bronco idled outside the old harbor gate.', 'suggestion-original-wb')
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')

    const resultStep = await waitForStep(steps, 'result')
    const result = resultStep!.detail as { proposedCodexChanges?: SuggestionRef[] }
    expect(result.proposedCodexChanges).toHaveLength(2)

    const [first, second] = result.proposedCodexChanges!
    expect((first.payload as { name: string }).name).toBe('Harborgate')
    expect((second.payload as { name: string }).name).toBe('The Bronco Crew')
    for (const suggestion of result.proposedCodexChanges!) {
      const payload = suggestion.payload as { citations: { note: string; reliability: string }[] }
      expect(payload.citations[0].reliability).toBe('low')
      expect(payload.citations[0].note).toBe(
        'Simulated inference from the selected passage — no external research was performed.'
      )
      expect(suggestion.provenance.refinesSuggestionId).toBe('suggestion-original-wb')
    }
  })

  it('uses author-stated citations for a real interview-path response', async () => {
    fakeOutputText = JSON.stringify({
      proposals: [{ entryType: 'world-rule', name: 'Fantasy Kingdom — World Rules', summary: 'The barrier never fails.' }]
    })

    const answers = {
      ...emptyWorldBuilderInterviewAnswers(),
      genreTemplate: 'fantasy-kingdom' as const,
      worldGrounding: 'A mountain kingdom cut off from the coast by an ancient magical barrier.',
      consistencyFacts: 'The barrier has never once failed in a thousand years.'
    }
    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal(encodeWorldBuilderInterview(answers))
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')

    const resultStep = await waitForStep(steps, 'result')
    const result = resultStep!.detail as { proposedCodexChanges?: SuggestionRef[] }
    expect(result.proposedCodexChanges).toHaveLength(1)
    const payload = result.proposedCodexChanges![0].payload as { citations: { reliability: string }[] }
    expect(payload.citations[0].reliability).toBe('author-stated')
  })

  it('falls back to the single-guess template path when the real output is malformed/non-JSON', async () => {
    fakeOutputText = 'not valid JSON at all'

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal('The Bronco idled outside the old harbor gate.')
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')

    const resultStep = await waitForStep(steps, 'result')
    const result = resultStep!.detail as { proposedCodexChanges?: SuggestionRef[] }
    expect(result.proposedCodexChanges).toHaveLength(1)
    const payload = result.proposedCodexChanges![0].payload as { citations: { reliability: string }[] }
    expect(payload.citations[0].reliability).toBe('low')
  })
})
