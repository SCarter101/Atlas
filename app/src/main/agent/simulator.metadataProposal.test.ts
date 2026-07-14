import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep, MetadataProposalPayload, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import type { SceneMeta } from '@shared/schema/manuscript'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { writeScene } from '../persistence/sceneStore'
import { setPreferredEmbeddingProvider } from '../retrieval/embeddings/select'
import { AgentRunManager, proposeSceneMetadataPatch } from './simulator'
import { waitForResultStep } from './simulator.testUtils'

const BASE_META: SceneMeta = {
  schemaVersion: 2,
  id: 'scene-1',
  chapterId: 'chapter-1',
  order: 0,
  title: 'Test Scene',
  wordCount: 0,
  status: 'drafting',
  updatedAt: new Date().toISOString()
}

describe('proposeSceneMetadataPatch (pure heuristic)', () => {
  it('proposes a value for "stakes" first when no craft fields are set', () => {
    const { proposedMeta, rationale } = proposeSceneMetadataPatch(BASE_META, 'Ray reached for the door. He hesitated.')
    expect(proposedMeta.craft?.stakes).toBeTruthy()
    expect(proposedMeta.craft?.turningPoint).toBeUndefined()
    expect(rationale).toContain('stakes')
  })

  it('falls through the priority order to the next empty field', () => {
    const meta: SceneMeta = { ...BASE_META, craft: { stakes: 'Already filled in.' } }
    const { proposedMeta } = proposeSceneMetadataPatch(meta, 'A beat of quiet tension.')
    expect(proposedMeta.craft?.turningPoint).toBeTruthy()
    // The already-filled field must be preserved, not clobbered, since the
    // proposal is a shallow patch of the whole `craft` object.
    expect(proposedMeta.craft?.stakes).toBe('Already filled in.')
  })

  it('re-evaluates the first-priority field when every craft field is already filled', () => {
    const meta: SceneMeta = {
      ...BASE_META,
      craft: {
        characterDesire: 'x',
        externalGoal: 'x',
        internalConflict: 'x',
        opposition: 'x',
        stakes: 'x',
        turningPoint: 'x',
        outcome: 'x',
        emotionalShift: 'x',
        revealedInformation: 'x'
      }
    }
    const { proposedMeta, rationale } = proposeSceneMetadataPatch(meta, 'Selection text.')
    expect(proposedMeta.craft?.stakes).toBeTruthy()
    expect(proposedMeta.craft?.stakes).not.toBe('x')
    expect(rationale).toContain('re-evaluated')
  })

  it('anchors the proposed value on the last sentence of the selection', () => {
    const { proposedMeta } = proposeSceneMetadataPatch(BASE_META, 'First sentence. Second sentence lands here.')
    expect(proposedMeta.craft?.stakes).toContain('Second sentence lands here.')
  })

  it('falls back to a generic prompt when there is no selection to anchor on', () => {
    const { proposedMeta } = proposeSceneMetadataPatch(BASE_META, '   ')
    expect(proposedMeta.craft?.stakes).toContain('stakes')
  })
})

describe('AgentRunManager — Dev-Editor metadata-proposal suggestion', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-metadata-proposal-'))
    db = await openIndexDb(projectRoot)
    // Phase 7: force the network-free hashing embedding adapter — see
    // simulator.budget.test.ts for the fuller rationale.
    setPreferredEmbeddingProvider('hashing')
  })

  afterEach(() => {
    setPreferredEmbeddingProvider(undefined)
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(): AgentGoal {
    return {
      runId: 'run-metadata-1',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-1'], selectionText: 'Ray watched the door, unsure what came next.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['structural-analysis']
      }
    }
  }

  it('includes a pending metadata-proposal suggestion alongside the editorial finding when the scene is indexed', async () => {
    await writeScene(projectRoot, db, 'scene-1', { meta: BASE_META, prose: 'Draft prose.' }, 'book-1/part-1/chapter-1', 'scene-1')

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }
    const metadataSuggestion = result.proposedManuscriptChanges?.find((s) => s.kind === 'metadata-proposal')

    expect(metadataSuggestion).toBeDefined()
    expect(metadataSuggestion?.state).toBe('pending')
    expect(metadataSuggestion?.targetSceneId).toBe('scene-1')
    const payload = metadataSuggestion?.payload as MetadataProposalPayload
    expect(payload.proposedMeta.craft?.stakes).toBeTruthy()
    expect(payload.rationale).toBeTruthy()

    // The editorial finding must still be present — the metadata proposal is
    // additive, not a replacement.
    expect(result.proposedManuscriptChanges?.some((s) => s.kind === 'editorial-finding')).toBe(true)
  })

  it('omits the metadata-proposal suggestion when the target scene is not indexed', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const resultStep = steps.find((s) => s.kind === 'result')!
    const result = resultStep.detail as { proposedManuscriptChanges?: SuggestionRef[] }
    expect(result.proposedManuscriptChanges?.some((s) => s.kind === 'metadata-proposal')).toBe(false)
    expect(result.proposedManuscriptChanges?.some((s) => s.kind === 'editorial-finding')).toBe(true)
  })
})
