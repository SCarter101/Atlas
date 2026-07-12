import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep, InsertionPayload, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { AgentRunManager } from './simulator'

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

async function runToCompletion(manager: AgentRunManager, goal: AgentGoal): Promise<AgentStep[]> {
  const steps: AgentStep[] = []
  manager.start(goal)
  manager.onStep(goal.runId, (step) => steps.push(step))

  const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
  manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
  await new Promise((resolve) => setTimeout(resolve, 0))
  return steps
}

describe('AgentRunManager — Generator opt-in multi-draft mode', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-generator-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
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
