import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentRunRecord, AgentStep, PermissionRequest, SuggestionRef } from '@shared/schema/agent'
import type { CapabilityRecommendationPayload } from '@shared/schema/agent'

// Same electron mock as simulator.devEditor.test.ts — registry's
// globalCapabilitiesDir() calls app.getPath('userData').
let userDataDir = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${name}) in test`)
    }
  }
}))

const { installSeedCapabilities } = await import('../capabilities/seedTools')
const { openIndexDb } = await import('../persistence/db')
const { saveAgentRun } = await import('../persistence/agentRunStore')
const { AgentRunManager } = await import('./simulator')
const { waitForResultStep } = await import('./simulator.testUtils')

// This is the end-to-end regression test for the capability-recommendation
// bug that a Codex review caught: the recorded Dev-Editor tool-call id is the
// versioned pseudo id 'global.tools.structural-analysis@1.0.0', which matches
// no installed manifest, so maybeRecommendCapability() used to bail and no
// recommendation ever surfaced. The earlier pure-function test used a real
// manifest id as its fixture and so never exercised this path.
describe('AgentRunManager — capability recommendation from repeated tool pattern', () => {
  let userDataRoot: string
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    userDataRoot = mkdtempSync(join(tmpdir(), 'atlas-userdata-'))
    userDataDir = userDataRoot
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-caprec-'))
    db = await openIndexDb(projectRoot)
    await installSeedCapabilities()
  })

  afterEach(() => {
    rmSync(userDataRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function priorDevEditorRun(runId: string): AgentRunRecord {
    const goal: AgentGoal = {
      runId,
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 3, maxElapsedMs: 30000, allowedCapabilityCategories: ['structural-analysis'] }
    }
    return {
      schemaVersion: 1,
      goal,
      status: 'completed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      // The exact toolId runDevEditor emits (versioned pseudo id, matches no manifest).
      steps: [{ stepIndex: 0, kind: 'tool-call', timestamp: new Date().toISOString(), detail: { toolId: 'global.tools.structural-analysis@1.0.0', input: {} } }]
    }
  }

  it('surfaces a capability-recommendation once the tool has recurred across 3+ prior runs', async () => {
    await saveAgentRun(projectRoot, db, priorDevEditorRun('prior-1'))
    await saveAgentRun(projectRoot, db, priorDevEditorRun('prior-2'))
    await saveAgentRun(projectRoot, db, priorDevEditorRun('prior-3'))

    const goal: AgentGoal = {
      runId: 'run-now',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 3, maxElapsedMs: 30000, allowedCapabilityCategories: ['structural-analysis'] }
    }

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const result = steps.find((s) => s.kind === 'result')!.detail as { proposedManuscriptChanges?: SuggestionRef[] }
    const rec = result.proposedManuscriptChanges?.find((s) => s.kind === 'capability-recommendation')
    expect(rec).toBeDefined()
    const payload = rec!.payload as CapabilityRecommendationPayload
    expect(payload.occurrences).toBe(3)
    expect(payload.draftManifest.lifecycleState).toBe('draft')
    expect(payload.draftManifest.compatibleAgentRoles).toEqual(['Dev-Editor'])
    // Synthesized (no installed manifest to clone) with a readable label.
    expect(payload.draftManifest.name).toContain('Structural Analysis')
  })

  it('does not recommend when the tool has not yet recurred enough', async () => {
    await saveAgentRun(projectRoot, db, priorDevEditorRun('prior-1'))
    await saveAgentRun(projectRoot, db, priorDevEditorRun('prior-2'))

    const goal: AgentGoal = {
      runId: 'run-now',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: { maxTurns: 4, maxTokens: 4000, maxToolCalls: 3, maxElapsedMs: 30000, allowedCapabilityCategories: ['structural-analysis'] }
    }

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const result = steps.find((s) => s.kind === 'result')!.detail as { proposedManuscriptChanges?: SuggestionRef[] }
    expect(result.proposedManuscriptChanges?.some((s) => s.kind === 'capability-recommendation')).toBe(false)
  })
})
