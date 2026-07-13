import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGoal, AgentStep, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import { openIndexDb, type AtlasDb } from '../persistence/db'
import { AgentRunManager } from './simulator'
import { waitForResultStep } from './simulator.testUtils'

describe('AgentRunManager — Line Editor simulated flow', () => {
  let projectRoot: string
  let db: AtlasDb

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-test-'))
    db = await openIndexDb(projectRoot)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(selectionText: string): AgentGoal {
    return {
      runId: 'run-1',
      agentRole: 'Line-Editor',
      // 'anthropic' (not 'openrouter'/'lm-studio') so this still exercises
      // the simulated flow via SimulatorAdapter — those two providers now
      // route to real-but-unconfigured adapters that throw (see
      // agent/providers/), matching what every real AgentGoal construction
      // site in the app actually sends today.
      modelRef: { provider: 'anthropic', modelId: 'gpt-4.1', viaOpenRouter: false },
      userIntent: 'Send selected text to Line Editor',
      scope: { sceneIds: ['scene-002'], selectionText },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['line-editing']
      }
    }
  }

  it('pauses on a real permission request and only proceeds after approval', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal('He noticed that the door was very heavy.')

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const permissionStep = steps.find((s) => s.kind === 'permission-request')
    expect(permissionStep).toBeDefined()
    const request = permissionStep!.detail as PermissionRequest
    expect(request.decision).toBe('pending')

    // Nothing past the permission request should have happened yet.
    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)

    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const toolCallStep = steps.find((s) => s.kind === 'tool-call')
    expect(toolCallStep).toBeDefined()

    const resultStep = steps.find((s) => s.kind === 'result')
    expect(resultStep).toBeDefined()
    const suggestions = (resultStep!.detail as { proposedManuscriptChanges?: SuggestionRef[] })
      .proposedManuscriptChanges
    expect(suggestions?.length).toBeGreaterThan(0)
    expect(suggestions?.[0].state).toBe('pending')
  })

  it('stops safely and proposes no changes when permission is denied', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal('Some selected prose.')

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'denied')
    await waitForResultStep(steps)

    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)
    const resultStep = steps.find((s) => s.kind === 'result')
    const result = resultStep!.detail as { proposedManuscriptChanges?: SuggestionRef[]; warnings?: string[] }
    expect(result.proposedManuscriptChanges ?? []).toHaveLength(0)
    expect(result.warnings?.length).toBeGreaterThan(0)
  })

  it('cancel() aborts a run waiting on permission the same way a denial would', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal('Some selected prose.')

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)
    manager.cancel(goal.runId)
    await waitForResultStep(steps)

    expect(steps.some((s) => s.kind === 'tool-call')).toBe(false)
    const resultStep = steps.find((s) => s.kind === 'result')
    expect(resultStep).toBeDefined()
    const result = resultStep!.detail as { warnings?: string[] }
    expect(result.warnings?.length).toBeGreaterThan(0)
  })

  it('cancel() on a run with no pending permission is a safe no-op', async () => {
    const manager = new AgentRunManager(projectRoot, db)
    // No run with this id was ever started — must not throw.
    expect(() => manager.cancel('never-started')).not.toThrow()
  })
})
