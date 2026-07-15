import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, DialogueAlternativePayload, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { upsertCodexEntry } from '../persistence/codexStore'
import { writeScene } from '../persistence/sceneStore'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'

// Phase 8 §7.4: when a real provider adapter actually returns JSON-mode
// outputText, runDialoguer's real branch should parse it into a structured
// 3-tier dialogue-alternative suggestion instead of the deterministic
// buildTensionAlternatives() template. Fake out the whole OpenRouterAdapter
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

const { AgentRunManager, parseRealDialogueAlternatives } = await import('./simulator')
const { cleanupTestDir } = await import('./simulator.testUtils')

describe('parseRealDialogueAlternatives — pure JSON-response validator', () => {
  it('accepts all 3 tiers regardless of the order the JSON lists them in', () => {
    const result = parseRealDialogueAlternatives({
      alternatives: [
        { tier: 'confrontational', text: 'Get out.' },
        { tier: 'calm', text: 'Please leave.' },
        { tier: 'guarded', text: "I'd rather you left." }
      ]
    })
    expect(result?.map((a) => a.tier)).toEqual(['calm', 'guarded', 'confrontational'])
  })

  it('rejects a response missing a required tier', () => {
    const result = parseRealDialogueAlternatives({
      alternatives: [
        { tier: 'calm', text: 'Please leave.' },
        { tier: 'guarded', text: "I'd rather you left." }
      ]
    })
    expect(result).toBeUndefined()
  })

  it('rejects a response with an empty/blank text field', () => {
    const result = parseRealDialogueAlternatives({
      alternatives: [
        { tier: 'calm', text: '   ' },
        { tier: 'guarded', text: "I'd rather you left." },
        { tier: 'confrontational', text: 'Get out.' }
      ]
    })
    expect(result).toBeUndefined()
  })

  it('rejects undefined and malformed shapes', () => {
    expect(parseRealDialogueAlternatives(undefined)).toBeUndefined()
    expect(parseRealDialogueAlternatives({})).toBeUndefined()
    expect(parseRealDialogueAlternatives({ alternatives: 'not an array' } as never)).toBeUndefined()
  })
})

function makeCharacter(overrides: Partial<CodexEntry> = {}): CodexEntry {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: 'char-1',
    type: 'character',
    name: 'Elena',
    status: 'canon',
    body: {},
    isPrivate: false,
    localModelOnly: false,
    locked: false,
    source: 'author',
    relationships: [],
    manuscriptLinks: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides
  }
}

function makeGoal(selectionText: string, sceneId: string): AgentGoal {
  return {
    runId: 'run-dialoguer-1',
    agentRole: 'Dialoguer',
    modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
    userIntent: 'Send selected dialogue to Dialogue Editor',
    scope: { sceneIds: [sceneId], selectionText },
    constraints: {
      maxTurns: 4,
      maxTokens: 4000,
      maxToolCalls: 3,
      maxElapsedMs: 30000,
      allowedCapabilityCategories: ['dialogue']
    }
  }
}

// A single `setTimeout(resolve, 0)` tick (the pattern the other simulator
// test files use) isn't enough here: unlike those flows, Dialoguer's run
// now does real fs.readFile-backed lookups (resolveDialogueCharacter /
// checkSimilarVoices) between the permission response and the 'result'
// step, which cross more than one real event-loop turn. Poll instead of
// assuming a fixed number of ticks.
async function runToCompletion(manager: InstanceType<typeof AgentRunManager>, goal: AgentGoal): Promise<AgentStep[]> {
  const steps: AgentStep[] = []
  manager.start(goal)
  manager.onStep(goal.runId, (step: AgentStep) => steps.push(step))

  const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
  if (request.decision === 'pending') {
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
  }

  const deadline = Date.now() + 2000
  while (!steps.some((s) => s.kind === 'result') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return steps
}

describe('AgentRunManager — Dialoguer voice-profile flow', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-dialoguer-test-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    cleanupTestDir(projectRoot)
  })

  it('resolves the scene POV character and generates tension-tiered alternatives from their voice profile', async () => {
    const character = makeCharacter({
      id: 'char-elena',
      name: 'Elena',
      voiceProfile: { formalityLevel: 'formal', speechDirectness: 'indirect' }
    })
    await upsertCodexEntry(projectRoot, db, character)
    await writeScene(
      projectRoot,
      db,
      'scene-1',
      { meta: { povCharacterId: 'char-elena', title: 'Scene One' }, prose: 'placeholder' },
      'book-1/part-1/chapter-1',
      'scene-one'
    )

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal('Get out.', 'scene-1')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const alternative = suggestions.find((s) => s.kind === 'dialogue-alternative')!
    expect(alternative).toBeDefined()

    const payload = alternative.payload as DialogueAlternativePayload
    expect(payload.characterName).toBe('Elena')
    expect(payload.alternatives.map((a) => a.tier)).toEqual(['calm', 'guarded', 'confrontational'])
    // formal + indirect should never produce the blunt "Full stop." phrasing.
    expect(payload.alternatives.find((a) => a.tier === 'confrontational')!.text).not.toContain('Full stop.')
  })

  it('falls back to no character attribution when nothing resolves', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal('Get out.', 'scene-unindexed')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const alternative = suggestions.find((s) => s.kind === 'dialogue-alternative')!
    const payload = alternative.payload as DialogueAlternativePayload
    expect(payload.characterName).toBeUndefined()
  })

  it('surfaces a similar-voice editorial finding when two characters overlap on 3+ profile fields', async () => {
    const shared = { vocabulary: 'plain, working-class', rhythm: 'short clipped sentences', formalityLevel: 'casual' as const }
    await upsertCodexEntry(projectRoot, db, makeCharacter({ id: 'char-ray', name: 'Ray', voiceProfile: shared }))
    await upsertCodexEntry(projectRoot, db, makeCharacter({ id: 'char-tull', name: 'Tull', voiceProfile: shared }))

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeGoal('Get out.', 'scene-1')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const finding = suggestions.find((s) => s.kind === 'editorial-finding')
    expect(finding).toBeDefined()
    expect((finding!.payload as { title: string }).title).toContain('Ray')
  })
})

function makeOpenRouterGoal(selectionText: string, sceneId: string, refinesSuggestionId?: string): AgentGoal {
  return {
    ...makeGoal(selectionText, sceneId),
    modelRef: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5', viaOpenRouter: true },
    refinesSuggestionId
  }
}

describe('AgentRunManager — Dialoguer real-model-output branch (Phase 8)', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-dialoguer-real-test-'))
    db = await openIndexDb(projectRoot)
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    fakeOutputText = ''
    cleanupTestDir(projectRoot)
  })

  it('parses well-formed JSON into a structured dialogue-alternative suggestion, threading refinesSuggestionId through', async () => {
    const character = makeCharacter({
      id: 'char-elena',
      name: 'Elena',
      voiceProfile: { formalityLevel: 'formal', speechDirectness: 'indirect' }
    })
    await upsertCodexEntry(projectRoot, db, character)
    await writeScene(
      projectRoot,
      db,
      'scene-1',
      { meta: { povCharacterId: 'char-elena', title: 'Scene One' }, prose: 'placeholder' },
      'book-1/part-1/chapter-1',
      'scene-one'
    )

    fakeOutputText = JSON.stringify({
      alternatives: [
        { tier: 'calm', text: 'If I may — please leave.' },
        { tier: 'guarded', text: "I'd rather you left. That's all I'll say." },
        { tier: 'confrontational', text: 'Get out. Now.' }
      ]
    })

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal('Get out.', 'scene-1', 'suggestion-original-1')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const alternative = suggestions.find((s) => s.kind === 'dialogue-alternative')!
    expect(alternative).toBeDefined()

    const payload = alternative.payload as DialogueAlternativePayload
    expect(payload.characterName).toBe('Elena')
    expect(payload.alternatives).toEqual([
      { tier: 'calm', text: 'If I may — please leave.' },
      { tier: 'guarded', text: "I'd rather you left. That's all I'll say." },
      { tier: 'confrontational', text: 'Get out. Now.' }
    ])
    expect(alternative.provenance.refinesSuggestionId).toBe('suggestion-original-1')

    // checkSimilarVoices' augmenting output is untouched by the real branch —
    // no character pair was seeded here, so none should appear.
    expect(suggestions.some((s) => s.kind === 'editorial-finding')).toBe(false)
  })

  it('falls back to the template path when the real output is malformed/non-JSON, and never sets refinesSuggestionId on the fallback', async () => {
    fakeOutputText = 'not valid JSON at all'

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal('Get out.', 'scene-unindexed', 'suggestion-original-2')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const alternative = suggestions.find((s) => s.kind === 'dialogue-alternative')!
    expect(alternative).toBeDefined()

    const payload = alternative.payload as DialogueAlternativePayload
    expect(payload.alternatives.map((a) => a.tier)).toEqual(['calm', 'guarded', 'confrontational'])
    // The template fallback path never threads refinesSuggestionId through —
    // only the real branch does (see runDialoguer in simulator.ts).
    expect(alternative.provenance.refinesSuggestionId).toBeUndefined()
  })

  it('falls back to the template path when a JSON tier is missing', async () => {
    fakeOutputText = JSON.stringify({
      alternatives: [
        { tier: 'calm', text: 'Please leave.' },
        { tier: 'guarded', text: "I'd rather you left." }
        // confrontational tier missing — must be treated as unusable.
      ]
    })

    const manager = new AgentRunManager(projectRoot, db)
    const goal = makeOpenRouterGoal('Get out.', 'scene-unindexed')
    const steps = await runToCompletion(manager, goal)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const suggestions = (resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }).proposedManuscriptChanges ?? []
    const alternative = suggestions.find((s) => s.kind === 'dialogue-alternative')!
    const payload = alternative.payload as DialogueAlternativePayload
    expect(payload.alternatives.map((a) => a.tier)).toEqual(['calm', 'guarded', 'confrontational'])
    expect(payload.alternatives.find((a) => a.tier === 'confrontational')!.text).not.toBe('')
  })
})
