import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep, DialogueAlternativePayload, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { upsertCodexEntry } from '../persistence/codexStore'
import { writeScene } from '../persistence/sceneStore'
import { AgentRunManager } from './simulator'

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
async function runToCompletion(manager: AgentRunManager, goal: AgentGoal): Promise<AgentStep[]> {
  const steps: AgentStep[] = []
  manager.start(goal)
  manager.onStep(goal.runId, (step) => steps.push(step))

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
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
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
