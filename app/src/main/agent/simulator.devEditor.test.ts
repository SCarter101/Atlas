import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentStep, PermissionRequest, ToolCall } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'

// See registry.test.ts — 'electron' resolves to a path string outside a
// running Electron process, so app.getPath('userData') (used by
// main/capabilities/registry.ts's globalCapabilitiesDir()) is mocked here.
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
const { upsertCodexEntry } = await import('../persistence/codexStore')
const { AgentRunManager } = await import('./simulator')
const { waitForResultStep } = await import('./simulator.testUtils')

describe('AgentRunManager — Dev-Editor real Codex contradiction check', () => {
  let userDataRoot: string
  let projectRoot: string
  let db: Awaited<ReturnType<typeof openIndexDb>>

  beforeEach(async () => {
    userDataRoot = mkdtempSync(join(tmpdir(), 'atlas-userdata-'))
    userDataDir = userDataRoot
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-deveditor-'))
    db = await openIndexDb(projectRoot)
    await installSeedCapabilities()
  })

  afterEach(() => {
    rmSync(userDataRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeGoal(): AgentGoal {
    return {
      runId: 'run-dev-editor-1',
      agentRole: 'Dev-Editor',
      modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
      userIntent: 'Send selected text to Story Editor',
      scope: { sceneIds: ['scene-002'], selectionText: 'Ray watched the door.' },
      constraints: {
        maxTurns: 4,
        maxTokens: 4000,
        maxToolCalls: 3,
        maxElapsedMs: 30000,
        allowedCapabilityCategories: ['structural-analysis']
      }
    }
  }

  function codexEntry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'name'>): CodexEntry {
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
      type: 'character',
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
      ...partial
    }
  }

  it('folds a real Codex contradiction count into the tool-call output and result when contradictions exist', async () => {
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'ray', name: 'Ray', relationships: [{ id: 'r1', targetEntryId: 'tull', kind: 'contradicts' }] }))
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'tull', name: 'Tull' }))

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const toolCallStep = steps.find((s) => s.kind === 'tool-call')
    const output = (toolCallStep!.detail as ToolCall).output as { codexContradictionCheck?: { summary: string } }
    expect(output.codexContradictionCheck?.summary).toContain('contradiction')

    const resultStep = steps.find((s) => s.kind === 'result')
    const result = resultStep!.detail as { summary: string; warnings?: string[] }
    expect(result.summary).toContain('contradiction')
    expect(result.warnings?.some((w) => w.includes('contradiction'))).toBe(true)
  })

  it('still completes normally with no contradiction note when the Codex has none', async () => {
    await upsertCodexEntry(projectRoot, db, codexEntry({ id: 'ray', name: 'Ray' }))

    const manager = new AgentRunManager(projectRoot, db)
    const steps: AgentStep[] = []
    const goal = makeGoal()

    manager.start(goal)
    manager.onStep(goal.runId, (step) => steps.push(step))

    const request = steps.find((s) => s.kind === 'permission-request')!.detail as PermissionRequest
    manager.respondToPermission(goal.runId, request.requestId, 'approved-once')
    await waitForResultStep(steps)

    const toolCallStep = steps.find((s) => s.kind === 'tool-call')
    const output = (toolCallStep!.detail as ToolCall).output
    expect(Array.isArray(output)).toBe(true)

    const resultStep = steps.find((s) => s.kind === 'result')
    expect(resultStep).toBeDefined()
    const result = resultStep!.detail as { summary: string }
    expect(result.summary).not.toContain('contradiction')
  })
})
