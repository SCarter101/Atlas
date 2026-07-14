import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import { emptyWorldBuilderInterviewAnswers, encodeWorldBuilderInterview } from '@shared/worldBuilderInterview'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'
import { AgentRunManager, deriveWorldBuilderProposals } from './simulator'

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
